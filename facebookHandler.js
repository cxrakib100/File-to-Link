const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

// ========== Multiple Facebook Download Engines ==========

async function engine1_fdown(fbUrl) {
  try {
    const res = await fetch('https://fdown.isuru.eu.org/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl, quality: 'best' }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.download_url || data?.url || (data?.available_formats && data.available_formats[0]?.url);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: data?.video_info?.title || data?.title || null,
        description: data?.video_info?.description || data?.description || null,
        author: data?.video_info?.uploader || data?.author || null,
        views: data?.video_info?.view_count || data?.views || null,
        reactions: data?.reactions || data?.like_count || null,
        comments: data?.comments || data?.comment_count || null,
        quality: 'HD',
        hasAudio: true
      };
    }
  } catch (e) {}
  return null;
}

async function engine2_mediasaver(fbUrl) {
  try {
    const res = await fetch('https://mediasaver.link/api/?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.video || data?.links?.hd || data?.links?.sd || data?.url || data?.download || data?.data?.video;
    if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: data.title || data?.data?.title || null,
        description: data?.description || data?.data?.description || null,
        author: data?.author || data?.data?.author || null,
        views: data?.views || data?.view_count || null,
        reactions: data?.likes || data?.reactions || null,
        comments: data?.comments || null,
        quality: data?.links?.hd ? 'HD' : 'SD',
        hasAudio: true
      };
    }
  } catch (e) {}
  return null;
}

async function engine3_fbdownxyz(fbUrl) {
  try {
    const res = await fetch('https://api.fbdown.xyz/api?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer HD with audio if available
    const videoUrl = data?.hd || data?.sd || data?.url || data?.download_url || (data?.links && data.links[0]?.url);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: data.title || null,
        description: data?.description || null,
        author: data?.author || null,
        views: data?.views || null,
        reactions: data?.likes || data?.reactions || null,
        comments: data?.comments || null,
        quality: data?.hd ? 'HD' : 'SD',
        hasAudio: true
      };
    }
  } catch (e) {}
  return null;
}

async function engine4_snapsave(fbUrl) {
  try {
    const res = await fetch('https://snapsave.app/action.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://snapsave.app',
        'Referer': 'https://snapsave.app/'
      },
      body: 'url=' + encodeURIComponent(fbUrl),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/https?:\/\/[^"'\s]+\.(mp4)[^"'\s]*/i) || text.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/i);
    if (match) {
      const videoUrl = (match[1] || match[0]).replace(/\\/g, '');
      if (videoUrl.startsWith('http')) {
        return { url: videoUrl, title: null, quality: 'HD', hasAudio: true };
      }
    }
  } catch (e) {}
  return null;
}

async function engine5_fdownnet(fbUrl) {
  try {
    const res = await fetch('https://fdown.net/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://fdown.net',
        'Referer': 'https://fdown.net/'
      },
      body: 'URLz=' + encodeURIComponent(fbUrl),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const hdMatch = html.match(/href="(https?:\/\/[^\"]+?)"[^>]*>\s*Download in HD/i) || html.match(/hdlink"[^>]*href="(https?:\/\/[^"]+)/i);
    const sdMatch = html.match(/href="(https?:\/\/[^\"]+?)"[^>]*>\s*Download in SD/i) || html.match(/sdlink"[^>]*href="(https?:\/\/[^"]+)/i);
    const videoUrl = (hdMatch && hdMatch[1]) || (sdMatch && sdMatch[1]);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl.replace(/&amp;/g, '&'),
        title: null,
        quality: hdMatch ? 'HD' : 'SD',
        hasAudio: true
      };
    }
  } catch (e) {}
  return null;
}

async function engine6_xcasper(fbUrl) {
  try {
    const res = await fetch('https://apis.xcasper.space/api/downloader/fb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.url || data?.download || data?.hd || data?.result?.url || data?.data?.url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: data?.title || null,
        description: data?.description || null,
        author: data?.author || data?.uploader || null,
        views: data?.views || data?.view_count || null,
        quality: 'HD',
        hasAudio: true
      };
    }
  } catch (e) {}
  return null;
}

async function engine7_fdownone(fbUrl) {
  try {
    const res = await fetch('https://fdown.one/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ url: fbUrl }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.url || data?.download || data?.hd || data?.sd || data?.links?.[0]?.url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return { url: videoUrl, title: data?.title || null, quality: 'HD', hasAudio: true };
    }
  } catch (e) {}
  return null;
}

// Race all engines - first successful + prefer HD with audio
async function getBestFacebookVideo(fbUrl) {
  const engines = [
    engine1_fdown,
    engine2_mediasaver,
    engine3_fbdownxyz,
    engine6_xcasper,
    engine4_snapsave,
    engine5_fdownnet,
    engine7_fdownone
  ];

  const results = await Promise.allSettled(engines.map(fn => fn(fbUrl)));

  let best = null;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && r.value.url) {
      if (!best) {
        best = r.value;
      } else {
        // Prefer HD + has title/description
        const score = (r.value.quality === 'HD' ? 2 : 0) + (r.value.title ? 1 : 0) + (r.value.hasAudio ? 1 : 0);
        const bestScore = (best.quality === 'HD' ? 2 : 0) + (best.title ? 1 : 0) + (best.hasAudio ? 1 : 0);
        if (score > bestScore) best = r.value;
      }
    }
  }
  return best;
}

function formatNumber(num) {
  if (!num) return null;
  const n = Number(String(num).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return null;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.floor(n));
}

function buildCaption(data) {
  let caption = '';

  // 1. Title
  if (data.title) {
    caption += '🎬 **' + data.title + '**\n\n';
  }

  // 2. Description / body text
  if (data.description) {
    let desc = data.description.trim();
    if (desc.length > 180) desc = desc.substring(0, 180) + '...';
    caption += desc + '\n\n';
  }

  // 3. Author
  if (data.author) {
    caption += '👤 **তৈরি করেছেন:** ' + data.author + '\n';
  }

  caption += '━━━━━━━━━━━━━━━━━━━━\n';

  // 4. Stats
  const views = formatNumber(data.views);
  const reactions = formatNumber(data.reactions);
  const comments = formatNumber(data.comments);

  if (views) caption += '👁 **Views:** ' + views + '\n';
  if (reactions) caption += '❤️ **Reactions:** ' + reactions + '\n';
  if (comments) caption += '💬 **Comments:** ' + comments + '\n';

  caption += '✨ **Quality:** ' + (data.quality || 'Best Available') + '\n';
  caption += '📱 **Source:** Facebook\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '⚡ **Power By Cx_Rakib**';

  return caption;
}

async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);

  if (!match) return false;

  const fbUrl = match[0];

  const statusMsg = await client.sendMessage(chatId, {
    message: '⏳ **ভিডিও আসছে...** ⚡ সুপার ফাস্ট মোড',
    parseMode: 'md',
  });

  try {
    const videoData = await getBestFacebookVideo(fbUrl);

    if (!videoData || !videoData.url) {
      throw new Error('No video found');
    }

    // If no title from API, try extract from original link text or keep generic
    if (!videoData.title) {
      videoData.title = 'Facebook Video';
    }

    const captionText = buildCaption(videoData);

    // Fast path - send video URL directly (fastest)
    const tgRes = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendVideo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        video: videoData.url,
        caption: captionText,
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

    // Fallback: download then upload
    const tempFilePath = path.join('/tmp', 'fb_' + Date.now() + '.mp4');
    const videoRes = await fetch(videoData.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(40000)
    });

    if (!videoRes.ok) throw new Error('Download failed');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(videoRes.body), fileStream);

    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: captionText,
      supportsStreaming: true,
    });

    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;

  } catch (err) {
    console.error('Facebook Download Error:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **Facebook ভিডিও নামাতে সমস্যা হয়েছে।**\n\nসম্ভাব্য কারণ:\n• ভিডিওটি প্রাইভেট / রিস্ট্রিক্টেড\n• লিংকটি সঠিক নয়\n• সার্ভিস সাময়িকভাবে ডাউন\n\nঅনুগ্রহ করে **পাবলিক** ভিডিওর লিংক দিয়ে আবার চেষ্টা করুন।',
    });
    return true;
  }
}

module.exports = { handleFacebookDownload };
