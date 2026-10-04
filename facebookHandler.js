const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

// ========== Facebook Engines (prefer links that usually have audio) ==========

async function engine1_fdownnet(fbUrl) {
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
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) return null;
    const html = await res.text();

    // SD first (usually has audio muxed), then HD
    const sdMatch = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Download in SD/i)
      || html.match(/sdlink[^>]*href=["'](https?:\/\/[^"']+)/i)
      || html.match(/href=["'](https?:\/\/[^"']*sd[^"']*)["']/i);
    const hdMatch = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Download in HD/i)
      || html.match(/hdlink[^>]*href=["'](https?:\/\/[^"']+)/i);

    const sdUrl = sdMatch && sdMatch[1] ? sdMatch[1].replace(/&amp;/g, '&') : null;
    const hdUrl = hdMatch && hdMatch[1] ? hdMatch[1].replace(/&amp;/g, '&') : null;

    // Prefer SD for audio
    const videoUrl = sdUrl || hdUrl;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: null,
        quality: sdUrl ? 'SD' : 'HD',
        hasAudioPriority: !!sdUrl
      };
    }
  } catch (e) {}
  return null;
}

async function engine2_fbdownxyz(fbUrl) {
  try {
    const res = await fetch('https://api.fbdown.xyz/api?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer SD (audio more reliable)
    const videoUrl = data?.sd || data?.hd || data?.url || data?.download_url || (data?.links && data.links[0]?.url);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        description: data?.description || null,
        author: data?.author || null,
        views: data?.views || data?.view_count || null,
        reactions: data?.likes || data?.reactions || data?.like_count || null,
        comments: data?.comments || data?.comment_count || null,
        quality: data?.sd && !data?.hd ? 'SD' : (data?.hd ? 'HD' : 'SD'),
        hasAudioPriority: !!data?.sd
      };
    }
  } catch (e) {}
  return null;
}

async function engine3_fdown(fbUrl) {
  try {
    const res = await fetch('https://fdown.isuru.eu.org/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl, quality: 'worst' }),
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
        reactions: data?.reactions || data?.like_count || data?.likes || null,
        comments: data?.comments || data?.comment_count || null,
        quality: 'SD',
        hasAudioPriority: true
      };
    }
  } catch (e) {}
  return null;
}

async function engine4_mediasaver(fbUrl) {
  try {
    const res = await fetch('https://mediasaver.link/api/?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer SD link if available
    const videoUrl = data?.links?.sd || data?.video || data?.links?.hd || data?.url || data?.download || data?.data?.video;
    if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title || data?.data?.title),
        description: data?.description || data?.data?.description || null,
        author: data?.author || data?.data?.author || null,
        views: data?.views || data?.view_count || null,
        reactions: data?.likes || data?.reactions || data?.like_count || null,
        comments: data?.comments || null,
        quality: data?.links?.sd ? 'SD' : 'HD',
        hasAudioPriority: !!data?.links?.sd
      };
    }
  } catch (e) {}
  return null;
}

async function engine5_xcasper(fbUrl) {
  try {
    const res = await fetch('https://apis.xcasper.space/api/downloader/fb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.sd || data?.url || data?.download || data?.hd || data?.result?.url || data?.data?.url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data?.title),
        description: data?.description || null,
        author: data?.author || data?.uploader || null,
        views: data?.views || data?.view_count || null,
        reactions: data?.reactions || data?.likes || data?.like_count || null,
        comments: data?.comments || null,
        quality: data?.sd ? 'SD' : 'HD',
        hasAudioPriority: !!data?.sd
      };
    }
  } catch (e) {}
  return null;
}

async function engine6_snapsave(fbUrl) {
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
        return { url: videoUrl, title: null, quality: 'HD', hasAudioPriority: false };
      }
    }
  } catch (e) {}
  return null;
}

function cleanTitle(t) {
  if (!t || typeof t !== 'string') return null;
  let s = t.trim();
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

async function getBestFacebookVideo(fbUrl) {
  const engines = [
    engine1_fdownnet,
    engine2_fbdownxyz,
    engine3_fdown,
    engine4_mediasaver,
    engine5_xcasper,
    engine6_snapsave
  ];

  const results = await Promise.allSettled(engines.map(fn => fn(fbUrl)));

  let best = {
    url: null,
    title: null,
    description: null,
    author: null,
    views: null,
    reactions: null,
    comments: null,
    quality: 'HD',
    hasAudioPriority: false
  };

  // First pass: prefer any result that has audio priority (SD)
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value || !r.value.url) continue;
    const v = r.value;

    if (v.hasAudioPriority && !best.hasAudioPriority) {
      best.url = v.url;
      best.quality = v.quality || 'SD';
      best.hasAudioPriority = true;
    } else if (!best.url) {
      best.url = v.url;
      best.quality = v.quality || 'HD';
      best.hasAudioPriority = !!v.hasAudioPriority;
    }

    // Always merge metadata
    if (v.title && !best.title) best.title = v.title;
    if (v.description && !best.description) best.description = v.description;
    if (v.author && !best.author) best.author = v.author;
    if (v.views && !best.views) best.views = v.views;
    if (v.reactions && !best.reactions) best.reactions = v.reactions;
    if (v.comments && !best.comments) best.comments = v.comments;
  }

  if (!best.url) return null;
  return best;
}

function buildCaption(data) {
  const views = formatNumber(data.views);
  const reactions = formatNumber(data.reactions);

  let caption = '';

  if (views || reactions) {
    const parts = [];
    if (views) parts.push(views + ' views');
    if (reactions) parts.push(reactions + ' reactions');
    caption += '📊 **' + parts.join(' · ') + '**\n\n';
  }

  const title = data.title || 'Facebook Video';
  caption += '🎬 **' + title + '**\n\n';

  if (data.description) {
    let desc = data.description.trim();
    if (!(data.title && desc.toLowerCase().includes(data.title.toLowerCase().substring(0, 25)))) {
      if (desc.length > 150) desc = desc.substring(0, 150).trim() + '...';
      caption += desc + '\n\n';
    }
  }

  if (data.author) {
    caption += '👤 **তৈরি করেছেন:** ' + data.author + '\n';
  }

  caption += '━━━━━━━━━━━━━━━━━━━━\n';
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

    if (!videoData.title) videoData.title = 'Facebook Video';

    const captionText = buildCaption(videoData);

    // Fast path - send video URL directly
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
