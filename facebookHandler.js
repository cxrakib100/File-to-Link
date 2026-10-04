const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

function cleanTitle(t) {
  if (!t || typeof t !== 'string') return 'Facebook Video';
  let s = t.trim()
    .replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*[·•|]\s*\d+(\.\d+)?[KkMm]?\s*reactions?\s*[·•|]?\s*/i, '')
    .replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*/i, '');
  if (s.length > 100) s = s.substring(0, 100).trim() + '...';
  return s || 'Facebook Video';
}

function buildCaption(data) {
  let caption = '⚡ **সুপারফাস্ট ডাউনলোড সম্পন্ন!**\n\n';
  caption += '🎬 **' + (data.title || 'Facebook Video') + '**\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '✨ **Quality:** ' + (data.quality || 'HD (Best Audio)') + '\n';
  caption += '📱 **Source:** Facebook\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '⚡ **Power By Cx_Rakib**';
  return caption;
}

function unescapeFb(str) {
  if (!str) return null;
  let clean = str.replace(/^["']|["']$/g, '');
  try {
    return JSON.parse('"' + clean + '"');
  } catch (e) {
    return clean
      .replace(/\\u0025/g, '%')
      .replace(/\\u0026/g, '&')
      .replace(/\\//g, '/')
      .replace(/\\"/g, '"');
  }
}

// 🚀 ENGINE 1: Native Ultra-Fast Scraper (১ সেকেন্ডের মধ্যে রেসপন্স)
async function engineNativeFb(fbUrl) {
  try {
    const res = await fetch(fbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error();
    const html = await res.text();

    const hd = html.match(/"browser_native_hd_url"\s*:\s*("[^"]+")/) || html.match(/"playable_url_quality_hd"\s*:\s*("[^"]+")/);
    const sd = html.match(/"browser_native_sd_url"\s*:\s*("[^"]+")/) || html.match(/"playable_url"\s*:\s*("[^"]+")/);

    const match = hd || sd;
    if (!match) throw new Error();

    const videoUrl = unescapeFb(match[1]);
    if (!videoUrl || !videoUrl.startsWith('http')) throw new Error();

    let title = null;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) title = cleanTitle(titleMatch[1]);

    return { url: videoUrl, title, quality: hd ? 'HD' : 'SD' };
  } catch {
    throw new Error('Native FB Failed');
  }
}

// 🚀 ENGINE 2: Cobalt High-Speed API (সুপারফাস্ট অডিও+ভিডিও রেন্ডারিং)
async function engineCobalt(fbUrl) {
  try {
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: fbUrl,
        videoQuality: 'max',
        audioFormat: 'mp3'
      }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    if (data && data.url) {
      return { url: data.url, title: 'Facebook Video', quality: 'HD' };
    }
    throw new Error();
  } catch {
    throw new Error('Cobalt Failed');
  }
}

// 🚀 ENGINE 3: FDown Isuru API (সুপার ফাস্ট yt-dlp ব্যাকএন্ড)
async function engineFdownApi(fbUrl) {
  try {
    const res = await fetch('https://fdown.isuru.eu.org/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl, quality: 'best' }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    const videoUrl = data?.download_url || data?.url || (data?.available_formats && data.available_formats[0]?.url);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data?.video_info?.title || data?.title),
        quality: 'HD'
      };
    }
    throw new Error();
  } catch {
    throw new Error('FDown Failed');
  }
}

// 🚀 ENGINE 4: FBDown XYZ High-Speed Mirror
async function engineFbdownxyz(fbUrl) {
  try {
    const res = await fetch('https://api.fbdown.xyz/api?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    const videoUrl = data?.hd || data?.sd || data?.url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        quality: data.hd ? 'HD' : 'SD'
      };
    }
    throw new Error();
  } catch {
    throw new Error('FbdownXYZ Failed');
  }
}

// 🚀 ENGINE 5: Mediasaver Link Ultra API
async function engineMediasaver(fbUrl) {
  try {
    const res = await fetch('https://mediasaver.link/api/?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    const videoUrl = data?.links?.hd || data?.links?.sd || data?.url;
    if (videoUrl && String(videoUrl).startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        quality: data.links?.hd ? 'HD' : 'SD'
      };
    }
    throw new Error();
  } catch {
    throw new Error('Mediasaver Failed');
  }
}

// ⚡ প্যারালাল রেসিং: সবগুলো ইঞ্জিন একসাথে চলবে, যে সবার আগে লিঙ্ক দেবে সে বিজয়ী হবে!
async function getFastestVideo(fbUrl) {
  try {
    return await Promise.any([
      engineNativeFb(fbUrl),
      engineCobalt(fbUrl),
      engineFdownApi(fbUrl),
      engineFbdownxyz(fbUrl),
      engineMediasaver(fbUrl)
    ]);
  } catch (err) {
    return null;
  }
}

// হাই-স্পিড ভিডিও স্ট্রিমিং ও লোকাল রাইটিং
async function downloadFast(url) {
  const tempPath = path.join(os.tmpdir(), 'fb_fast_' + Date.now() + '.mp4');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.facebook.com/'
    },
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) throw new Error('Download failed');
  const stream = fs.createWriteStream(tempPath, { highWaterMark: 1024 * 1024 }); // 1MB buffer for fast write
  await pipeline(Readable.fromWeb(res.body), stream);
  return tempPath;
}

// মূল হ্যান্ডলার ফাংশন
async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);
  if (!match) return false;

  const fbUrl = match[0];
  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **আল্ট্রা-ফাস্ট সার্চিং চালু...**\nকয়েক সেকেন্ড অপেক্ষা করুন 🚀',
    parseMode: 'md',
  });

  let localPath = null;

  try {
    // ১ সেকেন্ডের মধ্যে ফাস্টেস্ট সোর্স পাওয়া যাবে
    const videoData = await getFastestVideo(fbUrl);
    if (!videoData || !videoData.url) {
      throw new Error('কোনো সার্ভার থেকে ভিডিওর লিংক পাওয়া যায়নি');
    }

    // সাথে সাথে ডাউনলোড
    localPath = await downloadFast(videoData.url);
    const caption = buildCaption(videoData);

    // সরাসরি টেলিগ্রামে সুপারফাস্ট আপলোড
    await client.sendFile(chatId, {
      file: localPath,
      caption: caption,
      parseMode: 'md',
      supportsStreaming: true,
    });

    // স্ট্যাটাস মেসেজ রিমুভ ও ক্লিনআপ
    try { await client.deleteMessages(chatId, [statusMsg.id], { revoke: true }); } catch (e) {}
    if (localPath && fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch (e) {}

    return true;
  } catch (err) {
    if (localPath && fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch (e) {}

    try {
      await client.editMessage(chatId, {
        message: statusMsg.id,
        text: '❌ **ভিডিও নামানো যায়নি!**\n\nভিডিওটি প্রাইভেট অথবা লিংকটি ইনভ্যালিড। পাবলিক ভিডিওর লিংক দিয়ে আবার চেষ্টা করুন।',
        parseMode: 'md',
      });
    } catch (e) {}
    return true;
  }
}

module.exports = { handleFacebookDownload };
