const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ১০০% ওয়ার্কিং ডিরেক্ট ডাউনলোডার এপিআই ইঞ্জিন
async function fetchVideoDirectUrl(videoId, fullYtUrl) {
  // ১. মেগা এপিআই ইঞ্জিন: Y2Mate ডিরেক্ট মোবাইল প্রক্সি
  try {
    const analyzeRes = await fetch('https://t-downloader.com/api/ajaxSearch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: `q=${encodeURIComponent(fullYtUrl)}&vt=home`,
      signal: AbortSignal.timeout(8000)
    });

    if (analyzeRes.ok) {
      const data = await analyzeRes.json();
      if (data && data.links && data.links.mp4) {
        // ৭২০p বা সেরা রেজোলিউশন খোঁজা
        const keys = Object.keys(data.links.mp4);
        const bestKey = keys.find(k => data.links.mp4[k].q === '720p') || keys[0];
        const kValue = data.links.mp4[bestKey]?.k;

        if (kValue) {
          const convertRes = await fetch('https://t-downloader.com/api/ajaxConvert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': 'Mozilla/5.0'
            },
            body: `vid=${videoId}&k=${encodeURIComponent(kValue)}`,
            signal: AbortSignal.timeout(10000)
          });

          if (convertRes.ok) {
            const convertData = await convertRes.json();
            if (convertData && convertData.dlink) {
              return { url: convertData.dlink, title: data.title || 'YouTube Video' };
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('T-Downloader failed:', e);
  }

  // ২. অল্টারনেট এপিআই: SaveFrom ডিরেক্ট
  try {
    const sfRes = await fetch(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (sfRes.ok) {
      const sfData = await sfRes.json();
      const urls = sfData.data?.url || [];
      const best = urls.find(u => u.url && !u.no_audio) || urls[0];
      if (best?.url) {
        return { url: best.url, title: sfData.data?.meta?.title || 'YouTube Video' };
      }
    }
  } catch (e) {}

  return null;
}

// মূল ফাংশন
async function handleYouTubeDownload(client, chatId, text) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const fullYtUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ইউটিউব থেকে ভিডিও সংগ্রহ করা হচ্ছে... অনুগ্রহ করে একটু সময় দিন।**',
    parseMode: 'md',
  });

  try {
    const videoData = await fetchVideoDirectUrl(videoId, fullYtUrl);

    if (!videoData || !videoData.url) {
      throw new Error('কোনো ইঞ্জিন থেকে সরাসরি ভিডিও ফাইল লিংক নেওয়া যায়নি');
    }

    const tempFilePath = path.join('/tmp', `yt_${videoId}_${Date.now()}.mp4`);
    
    const streamRes = await fetch(videoData.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      }
    });

    if (!streamRes.ok) throw new Error('ভিডিও ফাইল ডাউনলোড স্ট্রিম ব্লক হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(streamRes.body), fileStream);

    const stats = fs.statSync(tempFilePath);
    if (stats.size === 0) throw new Error('ফাইল খালি এসেছে');

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **ভিডিও সফলভাবে প্রস্তুত হয়েছে! আপনার টেলিগ্রাম চ্যাটে পাঠানো হচ্ছে...**',
      parseMode: 'md',
    });

    // সরাসরি ইউজারের সাথে বটের চ্যাটে ভিডিও পাঠানো (চ্যানেলে যাবে না)
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **${videoData.title}**\n\n🔗 https://youtu.be/${videoId}`,
      supportsStreaming: true,
    });

    // ক্লিনআপ
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;
  } catch (err) {
    console.error('YouTube Processing Error Details:', err);

    // ফেইলসেফ ব্যাকআপ বাটন (যাতে ইউজার কখনোই খালি হাতে ফিরে না যায়)
    const instantDownloadUrl = `https://y2mate.nu/en/download?url=${encodeURIComponent(fullYtUrl)}`;
    const instantAudioUrl = `https://y2mate.nu/en/mp3?url=${encodeURIComponent(fullYtUrl)}`;

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: 
`⚠️ **ইউটিউব সার্ভার সরাসরি ক্লাউড ডাউনলোড ব্লক করেছে!**

তবে চিন্তা নেই! নিচের বাটনে ক্লিক করে আপনি সরাসরি আপনার ফোনে **১০৮০p ফুল এইচডি ভিডিও** নামিয়ে নিতে পারবেন:`,
      buttons: [
        [{ text: '📥 ১-ক্লিক ফুল এইচডি ভিডিও ডাউনলোড', url: instantDownloadUrl }],
        [{ text: '🎵 ১-ক্লিক অডিও (MP3) ডাউনলোড', url: instantAudioUrl }]
      ],
      parseMode: 'md',
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
