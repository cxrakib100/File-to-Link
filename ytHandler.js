const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// মাল্টিপল ওয়ার্কিং এপিআই ক্লাস্টার
const COBALT_SERVERS = [
  'https://cobalt.meowing.de',
  'https://cobalt.canine.tools',
  'https://co.wuk.sh'
];

async function fetchVideoDirectUrl(fullYtUrl) {
  for (const server of COBALT_SERVERS) {
    try {
      const res = await fetch(`${server}/`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: fullYtUrl,
          videoQuality: '1080',
          downloadMode: 'auto',
        })
      });

      if (res.ok) {
        const data = await res.json();
        const streamUrl = data.url || (data.picker && data.picker[0]?.url);
        if (streamUrl) return streamUrl;
      }
    } catch (e) {
      // পরবর্তী সার্ভারে চেষ্টা করবে
      continue;
    }
  }

  // সেকেন্ডারি ব্যাকআপ ইঞ্জিন (Invidious Direct Stream)
  try {
    const videoId = fullYtUrl.match(/(?:watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (videoId) {
      const invRes = await fetch(`https://invidious.nerdvpn.de/api/v1/videos/${videoId}`);
      if (invRes.ok) {
        const invData = await invRes.json();
        const format = invData.formatStreams?.reverse()?.[0];
        if (format && format.url) return format.url;
      }
    }
  } catch (e) {}

  return null;
}

// ইউটিউব ভিডিও সরাসরি টেলিগ্রাম চ্যাটে পাঠানোর মূল ফাংশন
async function handleYouTubeDownload(client, chatId, text) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const fullYtUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ইউটিউব থেকে ১০৮০p ফুল এইচডি ভিডিও প্রসেস করা হচ্ছে... দয়া করে কিছুক্ষণ অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    const directStreamUrl = await fetchVideoDirectUrl(fullYtUrl);

    if (!directStreamUrl) {
      throw new Error('ডিরেক্ট ভিডিও স্ট্রিম লিংক পাওয়া যায়নি');
    }

    const tempFilePath = path.join('/tmp', `yt_${videoId}_${Date.now()}.mp4`);
    const videoRes = await fetch(directStreamUrl);
    
    if (!videoRes.ok) throw new Error('ভিডিও ফাইল নামাতে সমস্যা হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **ভিডিও প্রস্তুত! আপনার টেলিগ্রাম চ্যাটে আপলোড করা হচ্ছে...**',
      parseMode: 'md',
    });

    // শুধুমাত্র এই চ্যাটেই ভিডিও পাঠানো হবে (চ্যানেলে যাবে না)
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **ইউটিউব ফুল এইচডি (1080p) ভিডিও!**\n\n🔗 https://youtu.be/${videoId}`,
      supportsStreaming: true,
    });

    // স্টেটাস মেসেজ ও টেম্পোরারি ফাইল রিমুভ
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;
  } catch (err) {
    console.error('YouTube Engine Error:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **ভিডিওটি সরাসরি প্রসেস করতে সাময়িক সমস্যা হয়েছে। অনুগ্রহ করে লিংকটি আবার পাঠান।**',
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
