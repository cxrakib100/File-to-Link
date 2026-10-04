const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

// ১. MediaSaver free API
async function getFromMediaSaver(fbUrl) {
  try {
    const apiUrl = `https://mediasaver.link/api/?url=${encodeURIComponent(fbUrl)}`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      const videoUrl = data?.video || data?.links?.hd || data?.links?.sd || data?.url || data?.download || data?.data?.video;
      if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
        return {
          url: videoUrl,
          title: data.title || data?.data?.title || 'Facebook Video',
          author: data.author || 'Facebook User'
        };
      }
    }
  } catch (e) {}
  return null;
}

// ২. Alternative free endpoint
async function getFromAlternative(fbUrl) {
  try {
    const apiUrl = `https://api.fbdown.xyz/api?url=${encodeURIComponent(fbUrl)}`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const data = await res.json();
      const videoUrl = data?.hd || data?.sd || data?.url || data?.download_url || (data?.links && data.links[0]?.url);
      if (videoUrl && videoUrl.startsWith('http')) {
        return {
          url: videoUrl,
          title: data.title || 'Facebook Video',
          author: data.author || 'Facebook User'
        };
      }
    }
  } catch (e) {}
  return null;
}

// ৩. Page scrape fallback (for some public videos)
async function getFromPageScrape(fbUrl) {
  try {
    const res = await fetch(fbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow'
    });

    if (!res.ok) return null;
    const html = await res.text();

    const hdMatch = html.match(/"playable_url_quality_hd":"([^"]+)"/) || html.match(/hd_src:"([^"]+)"/);
    const sdMatch = html.match(/"playable_url":"([^"]+)"/) || html.match(/sd_src:"([^"]+)"/);

    let videoUrl = null;
    if (hdMatch && hdMatch[1]) {
      videoUrl = hdMatch[1].replace(/\\u0025/g, '%').replace(/\\/g, '');
    } else if (sdMatch && sdMatch[1]) {
      videoUrl = sdMatch[1].replace(/\\u0025/g, '%').replace(/\\/g, '');
    }

    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: 'Facebook Video',
        author: 'Facebook User'
      };
    }
  } catch (e) {}
  return null;
}

async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);

  if (!match) return false;

  const fbUrl = match[0];

  const statusMsg = await client.sendMessage(chatId, {
    message: '⏳ **আপনার Facebook ভিডিওটি প্রস্তুত হচ্ছে... অনুগ্রহ করে একটু অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    let videoData = await getFromMediaSaver(fbUrl);

    if (!videoData || !videoData.url) {
      videoData = await getFromAlternative(fbUrl);
    }

    if (!videoData || !videoData.url) {
      videoData = await getFromPageScrape(fbUrl);
    }

    if (!videoData || !videoData.url) {
      throw new Error('ভিডিও লিংক পাওয়া যায়নি');
    }

    const title = videoData.title || 'Facebook Video';

    // Telegram-এ সরাসরি পাঠানোর চেষ্টা
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        video: videoData.url,
        caption: `🎬 **${title}**\n\n👤 **সোর্স:** Facebook\n✨ **কোয়ালিটি:** Best Available',
        parse_mode: 'Markdown',
        supports_streaming: true
      }),
      signal: AbortSignal.timeout(20000)
    });

    const tgData = await tgRes.json();

    if (tgData.ok) {
      await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      return true;
    }

    // ব্যাকআপ: লোকাল ডাউনলোড করে পাঠানো
    const tempFilePath = path.join('/tmp', `fb_${Date.now()}.mp4`);
    const videoRes = await fetch(videoData.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000)
    });

    if (!videoRes.ok) throw new Error('ভিডিও ফাইল ডাউনলোড ফেইল হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **${title}**\n\n👤 **সোর্স:** Facebook\n✨ **কোয়ালিটি:** Best Available',
      supportsStreaming: true,
    });

    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;

  } catch (err) {
    console.error('Facebook Download Error:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **Facebook ভিডিওটি নামাতে সমস্যা হয়েছে।**\n\nসম্ভাব্য কারণ:\n• ভিডিওটি প্রাইভেট / রিস্ট্রিক্টেড\n• লিংকটি সঠিক নয়\n• সার্ভিস সাময়িকভাবে ডাউন\n\nঅনুগ্রহ করে পাবলিক ভিডিওর লিংক দিয়ে আবার চেষ্টা করুন।',
    });
    return true;
  }
}

module.exports = { handleFacebookDownload };
