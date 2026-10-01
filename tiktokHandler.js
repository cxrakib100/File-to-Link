const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

// টিকটক ওয়াটারমার্ক ছাড়া আল্ট্রাফাস্ট ডিরেক্ট ইঞ্জিন
async function handleTikTokDownload(client, chatId, text) {
  const tiktokRegex = /(https?:\/\/(?:vt\.tiktok\.com|vm\.tiktok\.com|www\.tiktok\.com|tiktok\.com)\/[^\s]+)/;
  const match = text.match(tiktokRegex);

  if (!match) return false;

  const tiktokUrl = match[0];

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **টিকটক ভিডিও আনা হচ্ছে...**',
    parseMode: 'md',
  });

  try {
    // ১. TikWM থেকে সরাসরি ডিরেক্ট নো-ওয়াটারমার্ক লিংক নেওয়া (মাত্র ০.৫ সেকেন্ড)
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) throw new Error('টিকটক এপিআই রেসপন্স করেনি');
    const result = await res.json();

    if (result.code !== 0 || !result.data) {
      throw new Error(result.msg || 'ভিডিও লিংক পাওয়া যায়নি');
    }

    const data = result.data;
    const videoDownloadUrl = data.play || data.hdplay;
    const title = data.title || 'TikTok Video';
    const author = data.author?.nickname || 'TikTok User';

    // ২. টেলিগ্রামের নিজস্ব ক্লাউড দিয়ে সরাসরি ভিডিও পুশ (মাত্র ১-২ সেকেন্ড)
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        video: videoDownloadUrl,
        caption: `🎬 **${title}**\n\n👤 **তৈরি করেছেন:** ${author}\n✨ **কোয়ালিটি:** 1080p (No Watermark)`,
        parse_mode: 'Markdown',
        supports_streaming: true
      }),
      signal: AbortSignal.timeout(12000)
    });

    const tgData = await tgRes.json();

    // যদি সরাসরি চলে যায়, সাথে সাথে কাজ শেষ!
    if (tgData.ok) {
      await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      return true;
    }

    // ব্যাকআপ মেথড (যদি কোনো কারণে টেলিগ্রাম ক্লাউড রিডাইরেক্ট আটকে যায়)
    const tempFilePath = path.join('/tmp', `tiktok_${data.id || Date.now()}.mp4`);
    const videoRes = await fetch(videoDownloadUrl);
    if (!videoRes.ok) throw new Error('ভিডিও ফাইল ডাউনলোড ফেইল হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **${title}**\n\n👤 **তৈরি করেছেন:** ${author}\n✨ **কোয়ালিটি:** 1080p (No Watermark)`,
      supportsStreaming: true,
    });

    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;

  } catch (err) {
    console.error('TikTok Fast Download Error:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **টিকটক ভিডিওটি নামাতে সমস্যা হয়েছে। লিংকটি সঠিক কিনা দেখে আবার পাঠান।**',
    });
    return true;
  }
}

module.exports = { handleTikTokDownload };
