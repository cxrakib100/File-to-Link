const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// টিকটক ওয়াটারমার্ক ছাড়া আল্ট্রাফাস্ট ডাউনলোডার
async function handleTikTokDownload(client, chatId, text) {
  // টিকটক লিংক ডিটেকশন
  const tiktokRegex = /(https?:\/\/(?:vt\.tiktok\.com|vm\.tiktok\.com|www\.tiktok\.com|tiktok\.com)\/[^\s]+)/;
  const match = text.match(tiktokRegex);

  if (!match) return false;

  const tiktokUrl = match[0];

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **টিকটক থেকে ওয়াটারমার্ক ছাড়া ফুল এইচডি ভিডিও আনা হচ্ছে...**',
    parseMode: 'md',
  });

  try {
    // TikWM সুপারফাস্ট এপিআই (ওয়াটারমার্ক ছাড়া HD ভিডিওর জন্য)
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`;
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) throw new Error('টিকটক এপিআই রেসপন্স করেনি');

    const result = await res.json();

    if (result.code !== 0 || !result.data) {
      throw new Error(result.msg || 'ভিডিও পাওয়া যায়নি');
    }

    const data = result.data;
    // ফুল এইচডি (hdplay) অথবা সরাসরি ওয়াটারমার্ক ছাড়া ভিডিও (play)
    const videoDownloadUrl = data.hdplay || data.play;
    const title = data.title || 'TikTok Video';
    const author = data.author?.nickname || 'TikTok User';

    const tempFilePath = path.join('/tmp', `tiktok_${data.id || Date.now()}.mp4`);

    // ভিডিও স্ট্রিম নামানো
    const videoRes = await fetch(videoDownloadUrl);
    if (!videoRes.ok) throw new Error('ভিডিও ফাইল ডাউনলোড স্ট্রিম ফেইল হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **ভিডিও প্রস্তুত! আপনার টেলিগ্রাম চ্যাটে আপলোড করা হচ্ছে...**',
      parseMode: 'md',
    });

    // সরাসরি ইউজারের চ্যাটে নো-ওয়াটারমার্ক ভিডিও পাঠানো (চ্যানেলে যাবে না)
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: 
`🎬 **${title}**

👤 **তৈরি করেছেন:** ${author}
✨ **কোয়ালিটি:** 1080p Full HD (No Watermark)`,
      supportsStreaming: true,
    });

    // ক্লিনআপ
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;
  } catch (err) {
    console.error('TikTok Download Error:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **টিকটক ভিডিওটি নামাতে সমস্যা হয়েছে। লিংকটি সঠিক কিনা দেখে আবার পাঠান।**',
    });
    return true;
  }
}

module.exports = { handleTikTokDownload };
