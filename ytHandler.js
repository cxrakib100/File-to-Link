const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ৪টি শক্তিশালী ডিরেক্ট এপিআই ক্লাস্টার (একটি ব্যর্থ হলে অন্যটি চেষ্টা করবে)
async function getDirectVideoUrl(fullYtUrl, videoId) {
  // ১. ডেলিরিয়াস এপিআই ইঞ্জিন
  try {
    const res = await fetch(`https://delirius-apiofc.vercel.app/download/ytmp4?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (res.ok) {
      const data = await res.json();
      const dl = data.data?.download?.url || data.download?.url;
      if (dl) return { url: dl, title: data.data?.title || 'YouTube Video' };
    }
  } catch (e) {}

  // ২. সিপুতজেডএক্স সেভফ্রম ইঞ্জিন
  try {
    const res = await fetch(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (res.ok) {
      const data = await res.json();
      const urls = data.data?.url || data.result?.url || data.data || [];
      const videoObj = Array.isArray(urls) 
        ? urls.find(u => u.url && (u.ext === 'mp4' || u.type?.includes('mp4') || !u.no_audio)) || urls[0]
        : null;
      if (videoObj?.url) return { url: videoObj.url, title: data.data?.meta?.title || 'YouTube Video' };
    }
  } catch (e) {}

  // ৩. রাইজুমি ইঞ্জিন
  try {
    const res = await fetch(`https://api.ryzumi.net/api/downloader/all-in-one?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (res.ok) {
      const data = await res.json();
      const dl = data.result?.video || data.result?.url || (Array.isArray(data.result) && data.result[0]?.url);
      if (dl) return { url: dl, title: data.result?.title || 'YouTube Video' };
    }
  } catch (e) {}

  // ৪. ইনভিডিয়াস ক্লাউড স্ট্রিম ইঞ্জিন
  const invidiousHosts = ['invidious.nerdvpn.de', 'inv.nadeko.net', 'invidious.private.coffee'];
  for (const host of invidiousHosts) {
    try {
      const res = await fetch(`https://${host}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        const data = await res.json();
        const formats = data.formatStreams?.reverse() || [];
        const chosen = formats.find(f => f.url && f.container === 'mp4') || formats[0];
        if (chosen?.url) return { url: chosen.url, title: data.title || 'YouTube Video' };
      }
    } catch (e) {}
  }

  return null;
}

// সরাসরি টেলিগ্রাম বটে ভিডিও পাঠানোর মূল ফাংশন
async function handleYouTubeDownload(client, chatId, text) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const fullYtUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ইউটিউব থেকে অডিও সহ ফুল এইচডি ভিডিও প্রসেস করা হচ্ছে... অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    const videoData = await getDirectVideoUrl(fullYtUrl, videoId);

    if (!videoData || !videoData.url) {
      throw new Error('কোনো ইঞ্জিন থেকেই ভিডিও লিংক পাওয়া যায়নি');
    }

    const tempFilePath = path.join('/tmp', `yt_${videoId}_${Date.now()}.mp4`);
    const streamRes = await fetch(videoData.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!streamRes.ok) throw new Error('ভিডিও ফাইল নামাতে সমস্যা হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(streamRes.body), fileStream);

    const stats = fs.statSync(tempFilePath);
    if (stats.size === 0) throw new Error('ফাইল খালি এসেছে');

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **ভিডিও সফলভাবে প্রসেস হয়েছে! আপনার টেলিগ্রাম চ্যাটে আপলোড করা হচ্ছে...**',
      parseMode: 'md',
    });

    // শুধুমাত্র এই ইউজারের চ্যাটেই ভিডিও পাঠানো হচ্ছে (চ্যানেলে যাবে না)
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **${videoData.title}**\n\n🔗 https://youtu.be/${videoId}`,
      supportsStreaming: true, // টেলিগ্রামে সরাসরি প্লে হবে
    });

    // ক্লিনআপ
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;
  } catch (err) {
    console.error('YouTube Processing Error Details:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **ভিডিওটি নামাতে সাময়িক সমস্যা হয়েছে। অনুগ্রহ করে আবার লিংকটি পাঠান।**',
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
