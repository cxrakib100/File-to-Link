const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ইউটিউবের নিজস্ব অফিশিয়াল InnerTube ইঞ্জিন দিয়ে সরাসরি ভিডিও লিংক বের করা
async function getDirectVideoUrl(videoId) {
  // ১. ইউটিউব অ্যান্ড্রয়েড ক্লায়েন্ট ইঞ্জিন
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.05.36 (Linux; U; Android 11; en_US) gzip'
      },
      body: JSON.stringify({
        videoId: videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.05.36',
            androidSdkVersion: 30
          }
        }
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const data = await res.json();
      const title = data.videoDetails?.title || 'YouTube Video';
      const formats = data.streamingData?.formats || [];
      // অডিও সহ ৭২০p বা ৩৬০p সরাসরি ভিডিও
      const best = formats.find(f => f.url && f.qualityLabel === '720p') || formats.find(f => f.url);
      if (best?.url) {
        return { url: best.url, title: title };
      }
    }
  } catch (e) {
    console.error('Android InnerTube failed:', e);
  }

  // ২. ইউটিউব আইওএস ক্লায়েন্ট ইঞ্জিন
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/19.29.1 (iPhone14,5; U; CPU iOS 17_5 like Mac OS X)'
      },
      body: JSON.stringify({
        videoId: videoId,
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: '19.29.1',
            deviceMake: 'Apple',
            deviceModel: 'iPhone14,5'
          }
        }
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const data = await res.json();
      const title = data.videoDetails?.title || 'YouTube Video';
      const formats = data.streamingData?.formats || [];
      const best = formats.find(f => f.url && f.qualityLabel === '720p') || formats.find(f => f.url);
      if (best?.url) {
        return { url: best.url, title: title };
      }
    }
  } catch (e) {
    console.error('iOS InnerTube failed:', e);
  }

  // ৩. ব্যাকআপ রেস্ট এপিআই (Siputzx API)
  try {
    const res = await fetch(`https://api.siputzx.my.id/api/d/savefrom?url=https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      const urls = data.data?.url || data.result?.url || [];
      const best = Array.isArray(urls) ? urls.find(u => u.url && !u.no_audio) || urls[0] : null;
      if (best?.url) {
        return { url: best.url, title: data.data?.meta?.title || 'YouTube Video' };
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

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ইউটিউব থেকে অডিও সহ সরাসরি ভিডিও প্রস্তুত করা হচ্ছে... অনুগ্রহ করে একটু অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    const videoData = await getDirectVideoUrl(videoId);

    if (!videoData || !videoData.url) {
      throw new Error('ভিডিও লিংক জেনারেট করা সম্ভব হয়নি');
    }

    const tempFilePath = path.join('/tmp', `yt_${videoId}_${Date.now()}.mp4`);
    
    const streamRes = await fetch(videoData.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
