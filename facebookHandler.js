const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

// ========== Fast Facebook Engines (parallel race) ==========

async function engine1_fdown(fbUrl) {
  try {
    const res = await fetch('https://fdown.isuru.eu.org/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl, quality: 'best' }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.download_url || data?.url || (data?.available_formats && data.available_formats[0]?.url);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data?.video_info?.title || data?.title),
        description: data?.video_info?.description || data?.description || null,
        author: data?.video_info?.uploader || data?.author || null,
        views: data?.video_info?.view_count || data?.views || null,
        reactions: data?.reactions || data?.like_count || null,
        comments: data?.comments || data?.comment_count || null,
        quality: 'HD'
      };
    }
  } catch (e) {}
  return null;
}

async function engine2_mediasaver(fbUrl) {
  try {
    const res = await fetch('https://mediasaver.link/api/?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.video || data?.links?.hd || data?.links?.sd || data?.url || data?.download || data?.data?.video;
    if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title || data?.data?.title),
        description: data?.description || data?.data?.description || null,
        author: data?.author || data?.data?.author || null,
        views: data?.views || data?.view_count || null,
        reactions: data?.likes || data?.reactions || null,
        comments: data?.comments || null,
        quality: data?.links?.hd ? 'HD' : 'SD'
      };
    }
  } catch (e) {}
  return null;
}

async function engine3_fbdownxyz(fbUrl) {
  try {
    const res = await fetch('https://api.fbdown.xyz/api?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer SD sometimes because it more often has audio muxed
    const videoUrl = data?.sd || data?.hd || data?.url || data?.download_url || (data?.links && data.links[0]?.url);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        description: data?.description || null,
        author: data?.author || null,
        views: data?.views || null,
        reactions: data?.likes || data?.reactions || null,
        comments: data?.comments || null,
        quality: data?.hd ? 'HD' : 'SD'
      };
    }
  } catch (e) {}
  return null;
}

async function engine4_xcasper(fbUrl) {
  try {
    const res = await fetch('https://apis.xcasper.space/api/downloader/fb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.url || data?.download || data?.hd || data?.sd || data?.result?.url || data?.data?.url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data?.title),
        description: data?.description || null,
        author: data?.author || data?.uploader || null,
        views: data?.views || data?.view_count || null,
        reactions: data?.reactions || data?.likes || null,
        comments: data?.comments || null,
        quality: 'HD'
      };
    }
  } catch (e) {}
  return null;
}

async function engine5_snapsave(fbUrl) {
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
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i) || text.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/i);
    if (match) {
      const videoUrl = (match[1] || match[0]).replace(/\\/g, '');
      if (videoUrl.startsWith('http')) {
        return { url: videoUrl, title: null, quality: 'HD' };
      }
    }
  } catch (e) {}
  return null;
}

async function engine6_fdownnet(fbUrl) {
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
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Prefer SD link first (more often has audio)
    const sdMatch = html.match(/href="(https?:\/\/[^\"]+?)"[^>]*>\s*Download in SD/i) || html.match(/sdlink"[^>]*href="(https?:\/\/[^"]+)/i);
    const hdMatch = html.match(/href="(https?:\/\/[^\"]+?)"[^>]*>\s*Download in HD/i) || html.match(/hdlink"[^>]*href="(https?:\/\/[^"]+)/i);
    const videoUrl = (sdMatch && sdMatch[1]) || (hdMatch && hdMatch[1]);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl.replace(/&amp;/g, '&'),
        title: null,
        quality: sdMatch ? 'SD' : 'HD'
      };
    }
  } catch (e) {}
  return null;
}

function cleanTitle(t) {
  if (!t || typeof t !== 'string') return null;
  let s = t.trim();
  // Remove view/reaction prefixes that APIs sometimes put in title
  s = s.replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*[·•|]\s*\d+(\.\d+)?[KkMm]?\s*reactions?\s*[·•|]?\s*/i, '');
  s = s.replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*/i, '');
  if (s.length > 120) s = s.substring(0, 120).trim() + '...';
  return s || null;
}

function formatNumber(num) {
  if (num === null || num === undefined || num === '') return null;
  const n = Number(String(num).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return null;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.floor(n));
}

// Race engines - take first good result quickly
async function getBestFacebookVideo(fbUrl) {
  const engines = [
    engine1_fdown,
    engine2_mediasaver,
    engine3_fbdownxyz,
    engine4_xcasper,
    engine5_snapsave,
    engine6_fdownnet
  ];

  // Promise.any style - first success wins, but we still collect for better metadata
  const results = await Promise.allSettled(engines.map(fn => fn(fbUrl)));

  let best = null;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && r.value.url) {
      if (!best) {
        best = r.value;
      } else {
        // Prefer one with title + views
        const score = (r.value.title ? 2 : 0) + (r.value.views ? 1 : 0) + (r.value.quality === 'HD' ? 1 : 0);
        const bestScore = (best.title ? 2 : 0) + (best.views ? 1 : 0) + (best.quality === 'HD' ? 1 : 0);
        if (score > bestScore) best = r.value;
      }
    }
  }
  return best;
}

function buildCaption(data) {
  const views = formatNumber(data.views);
  const reactions = formatNumber(data.reactions);
  const comments = formatNumber(data.comments);

  let caption = '';

  // ===== Layer 1: Views + Reactions (separate top line) =====
  if (views || reactions) {
    const parts = [];
    if (views) parts.push(views + ' views');
    if (reactions) parts.push(reactions + ' reactions');
    caption += '📊 **' + parts.join(' · ') + '**\n\n';
  }

  // ===== Layer 2: Clean Title =====
  const title = data.title || 'Facebook Video';
  caption += '🎬 **' + title + '**\n\n';

  // ===== Layer 3: Description (if different from title) =====
  if (data.description) {
    let desc = data.description.trim();
    // Avoid repeating the title
    if (data.title && desc.toLowerCase().includes(data.title.toLowerCase().substring(0, 30))) {
      // skip or shorten
    } else {
      if (desc.length > 150) desc = desc.substring(0, 150).trim() + '...';
      caption += desc + '\n\n';
    }
  }

  // ===== Layer 4: Author =====
  if (data.author) {
    caption += '👤 **তৈরি করেছেন:** ' + data.author + '\n';
  }

  caption += '━━━━━━━━━━━━━━━━━━━━\n';

  // ===== Layer 5: Quality + Source =====
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
    message: '⏳ **ভিডিও আসছে...** ⚡',
    parseMode: 'md',
  });

  try {
    const videoData = await getBestFacebookVideo(fbUrl);

    if (!videoData || !videoData.url) {
      throw new Error('No video found');
    }

    if (!videoData.title) {
      videoData.title = 'Facebook Video';
    }

    const captionText = buildCaption(videoData);

    // Fast path - Telegram direct send
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
      signal: AbortSignal.timeout(18000)
    });

    const tgData = await tgRes.json();

    if (tgData.ok) {
      await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      return true;
    }

    // Fallback download
    const tempFilePath = path.join('/tmp', 'fb_' + Date.now() + '.mp4');
    const videoRes = await fetch(videoData.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(35000)
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
