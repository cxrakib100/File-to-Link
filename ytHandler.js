const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// পাওয়ারফুল ইঞ্জিন দিয়ে সরাসরি ইউটিউব ভিডিও লিংক নেওয়া
async function getDirectVideoUrl(videoId, fullYtUrl) {
  // ১. মেগা ইঞ্জিন: Apple VisionOS InnerTube ডিরেক্ট বাইপাস
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        'X-YouTube-Client-Name': '101',
        'X-YouTube-Client-Version': '1.02'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'VISIONOS',
            clientVersion: '1.02',
            deviceMake: 'Apple',
            deviceModel: 'Apple Vision Pro'
          }
        },
        videoId: videoId
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const data = await res.json();
      const title = data.videoDetails?.title || 'YouTube Video';
      const formats = data.streamingData?.formats || [];
      // অডিও ও ভিডিও একসাথে থাকা সরাসরি প্রগ্রেসিভ MP4 স্ট্রিম
      const best = formats.find(f => f.url && f.qualityLabel === '720p') || formats.find(f => f.url);
      if (best?.url) {
        return { url: best.url, title: title };
      }
    }
  } catch (e) {
    console.error('VisionOS Engine error:', e);
  }

  // ২. সেকেন্ডারি ব্যাকআপ ইঞ্জিন: SaveNow গ্লোবাল সিডিএন
  try {
    const saveRes = await fetch(`https://p.savenow.to/ajax/download.php?copyright=0&allow_extended_duration=1&apikey=dfcb6d76f2f6a9894gjkege8a4ab232222&format=720&url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000)
    });

    if (saveRes.ok) {
      const sData = await saveRes.json();
      if (sData.id) {
        // প্রগ্রেস চেক
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const pRes = await fetch(`https://p.savenow.to/ajax/progress.php?id=${sData.id}`);
          if (pRes.ok) {
            const pData = await pRes.json();
            if (pData.success && pData.download_url) {
              return { url: pData.download_url, title: sData.info?.title || 'YouTube Video' };
            }
          }
        }
      }
    }
  } catch (e) {}

  // ৩. থার্ড ব্যাকআপ ইঞ্জিন: Siputzx
  try {
    const sipRes = await fetch(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (sipRes.ok) {
      const sData = await sipRes.json();
      const urls = sData.data?.url || [];
      const best = urls.find(u => u.url && !u.no_audio) || urls[0];
      if (best?.url) {
        return { url: best.url, title: sData.data?.meta?.title || 'YouTube Video' };
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
    message: '⚡ **ইউটিউব থেকে অডিও সহ সরাসরি ভিডিও প্রস্তুত করা হচ্ছে... অনুগ্রহ করে একটু অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    const videoData = await getDirectVideoUrl(videoId, fullYtUrl);

    if (!videoData || !videoData.url) {
      throw new Error('কোনো ইঞ্জিন থেকেই ভিডিও লিংক পাওয়া যায়নি');
    }

    const tempFilePath = path.join('/tmp', `yt_${videoId}_${Date.now()}.mp4`);
    
    const streamRes = await fetch(videoData.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        'Accept': '*/*'
      }
    });

    if (!streamRes.ok) throw new Error('ভিডিও ডাউনলোড করতে সমস্যা হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(streamRes.body), fileStream);

    const stats = fs.statSync(tempFilePath);
    if (stats.size === 0) throw new Error('ফাইল শূন্য এসেছে');

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **ভিডিও সফলভাবে প্রস্তুত হয়েছে! আপনার টেলিগ্রাম চ্যাটে পাঠানো হচ্ছে...**',
      parseMode: 'md',
    });

    // সরাসরি ইউজারের চ্যাটে ভিডিও পাঠানো হচ্ছে (চ্যানেলে যাবে না)
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
    console.error('YouTube Processing Error:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **ভিডিওটি নামাতে সাময়িক সমস্যা হয়েছে। অনুগ্রহ করে আবার লিংকটি পাঠান।**',
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
