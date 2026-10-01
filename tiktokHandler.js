const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

// ১. SSSTik.io থেকে সরাসরি ভিডিও লিংক আনার ইঞ্জিন
async function getFromSSSTik(tiktokUrl) {
  try {
    const homeRes = await fetch('https://ssstik.io/en', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(4000)
    });

    const homeHtml = await homeRes.text();
    const ttMatch = homeHtml.match(/tt:'([^']+)'/) || homeHtml.match(/s_tt\s*=\s*'([^']+)'/);
    if (!ttMatch) return null;

    const tt = ttMatch[1];
    const postRes = await fetch('https://ssstik.io/abc?url=dl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: `id=${encodeURIComponent(tiktokUrl)}&locale=en&tt=${tt}`,
      signal: AbortSignal.timeout(5000)
    });

    const postHtml = await postRes.text();
    const linkMatch = postHtml.match(/href="([^"]+)"[^>]*without_watermark_direct/) 
                   || postHtml.match(/href="([^"]+)"[^>]*without_watermark/);

    if (linkMatch && linkMatch[1]) {
      return { url: linkMatch[1], title: 'TikTok Video (via SSSTik)' };
    }
  } catch (e) {
    console.error('SSSTik Engine error:', e);
  }
  return null;
}

// ২. SnapTik / TikWM সুপারফাস্ট ইঞ্জিন
async function getFromSnapTik(tiktokUrl) {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(4000)
    });

    if (res.ok) {
      const result = await res.json();
      if (result.code === 0 && result.data) {
        const data = result.data;
        return {
          url: data.hdplay || data.play,
          title: data.title || 'TikTok Video',
          author: data.author?.nickname || 'TikTok Creator'
        };
      }
    }
  } catch (e) {
    console.error('SnapTik Engine error:', e);
  }
  return null;
}

// মূল ফাংশন (SSSTik + SnapTik কম্বাইন্ড ইঞ্জিন)
async function handleTikTokDownload(client, chatId, text) {
  const tiktokRegex = /(https?:\/\/(?:vt\.tiktok\.com|vm\.tiktok\.com|www\.tiktok\.com|tiktok\.com)\/[^\s]+)/;
  const match = text.match(tiktokRegex);

  if (!match) return false;

  const tiktokUrl = match[0];

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **SSSTik & SnapTik দিয়ে ভিডিও সংগ্রহ করা হচ্ছে...**',
    parseMode: 'md',
  });

  try {
    // দ্রুততম ইঞ্জিন দিয়ে লিংক নেওয়া (SnapTik আগে চেষ্টা করবে, ফেইল হলে SSSTik)
    let videoData = await getFromSnapTik(tiktokUrl);

    if (!videoData || !videoData.url) {
      console.log('Trying fallback to SSSTik.io...');
      videoData = await getFromSSSTik(tiktokUrl);
    }

    if (!videoData || !videoData.url) {
      throw new Error('কোনো ইঞ্জিন থেকেই ভিডিও লিংক নেওয়া যায়নি');
    }

    const title = videoData.title || 'TikTok Video';
    const author = videoData.author || 'TikTok User';

    // টেলিগ্রাম ক্লাউড ইঞ্জিন দিয়ে ২-৩ সেকেন্ডে সরাসরি চ্যাটে পাঠানো
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        video: videoData.url,
        caption: `🎬 **${title}**\n\n👤 **তৈরি করেছেন:** ${author}\n✨ **কোয়ালিটি:** 1080p No Watermark (SSSTik & SnapTik)`,
        parse_mode: 'Markdown',
        supports_streaming: true
      }),
      signal: AbortSignal.timeout(12000)
    });

    const tgData = await tgRes.json();

    if (tgData.ok) {
      await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      return true;
    }

    // ব্যাকআপ লোকাল স্ট্রিম (যদি টেলিগ্রাম ক্লাউড সরাসরি ইউআরএল ফেচ করতে ব্যর্থ হয়)
    const tempFilePath = path.join('/tmp', `tiktok_${Date.now()}.mp4`);
    const videoRes = await fetch(videoData.url);
    if (!videoRes.ok) throw new Error('ভিডিও ফাইল ডাউনলোড ফেইল হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **${title}**\n\n👤 **তৈরি করেছেন:** ${author}\n✨ **কোয়ালিটি:** 1080p No Watermark`,
      supportsStreaming: true,
    });

    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;

  } catch (err) {
    console.error('TikTok Final Error:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **ভিডিওটি নামাতে সমস্যা হয়েছে। লিংকটি সঠিক কিনা দেখে আবার পাঠান।**',
    });
    return true;
  }
}

module.exports = { handleTikTokDownload };
