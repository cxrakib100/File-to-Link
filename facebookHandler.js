const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

let youtubedl = null;
try {
  youtubedl = require('youtube-dl-exec');
} catch (e) {
  console.error('youtube-dl-exec not loaded');
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
  caption += '🎬 **' + (data.title || 'Facebook Video') + '**\n\n';
  if (data.description) {
    let desc = data.description.trim();
    if (!(data.title && desc.toLowerCase().includes(String(data.title).toLowerCase().substring(0, 25)))) {
      if (desc.length > 150) desc = desc.substring(0, 150).trim() + '...';
      caption += desc + '\n\n';
    }
  }
  if (data.author) caption += '👤 **তৈরি করেছেন:** ' + data.author + '\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '✨ **Quality:** ' + (data.quality || 'Best Available') + '\n';
  caption += '📱 **Source:** Facebook\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '⚡ **Power By Cx_Rakib**';
  return caption;
}

function unescapeFb(str) {
  if (!str) return null;
  try {
    return JSON.parse('"' + str.replace(/^"|"$/g, '') + '"');
  } catch (e) {
    return str
      .replace(/\\u0025/g, '%')
      .replace(/\\u0026/g, '&')
      .replace(/\\//g, '/')
      .replace(/\\"/g, '"');
  }
}

// ========== ENGINE 1: Facebook native progressive URLs (usually HAVE AUDIO) ==========
async function engineNativeFb(fbUrl) {
  try {
    const res = await fetch(fbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Cobalt-style extraction — these progressive URLs usually include audio
    const hdMatch = html.match(/"browser_native_hd_url"\s*:\s*("[^"]+")/);
    const sdMatch = html.match(/"browser_native_sd_url"\s*:\s*("[^"]+")/);
    const playableHd = html.match(/"playable_url_quality_hd"\s*:\s*("[^"]+")/);
    const playable = html.match(/"playable_url"\s*:\s*("[^"]+")/);

    let videoUrl = null;
    let quality = 'HD';

    if (hdMatch) {
      videoUrl = unescapeFb(hdMatch[1]);
      quality = 'HD';
    } else if (playableHd) {
      videoUrl = unescapeFb(playableHd[1]);
      quality = 'HD';
    } else if (sdMatch) {
      videoUrl = unescapeFb(sdMatch[1]);
      quality = 'SD';
    } else if (playable) {
      videoUrl = unescapeFb(playable[1]);
      quality = 'SD';
    }

    if (!videoUrl || !videoUrl.startsWith('http')) return null;

    // Title / author from page
    let title = null;
    const titleMatch = html.match(/"text"\s*:\s*"([^"]{10,120})"/) || html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) title = cleanTitle(titleMatch[1].replace(/\\n/g, ' ').replace(/&amp;/g, '&'));

    let author = null;
    const authorMatch = html.match(/"owner_name"\s*:\s*"([^"]+)"/) || html.match(/"name"\s*:\s*"([^"]+)"[^}]*"__typename"\s*:\s*"User"/);
    if (authorMatch) author = authorMatch[1];

    let views = null;
    const viewsMatch = html.match(/"play_count"\s*:\s*(\d+)/) || html.match(/"video_view_count"\s*:\s*(\d+)/);
    if (viewsMatch) views = viewsMatch[1];

    let reactions = null;
    const reactMatch = html.match(/"reaction_count"\s*:\s*\{\s*"count"\s*:\s*(\d+)/) || html.match(/"likers"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
    if (reactMatch) reactions = reactMatch[1];

    return {
      url: videoUrl,
      title,
      author,
      views,
      reactions,
      quality,
      hasAudio: true // native progressive usually has audio
    };
  } catch (e) {
    console.error('Native FB error:', e.message);
    return null;
  }
}

// ========== ENGINE 2: yt-dlp with ffmpeg merge (Render has ffmpeg) ==========
async function engineYtDlp(fbUrl) {
  if (!youtubedl) return null;
  const outPath = path.join('/tmp', 'fb_yt_' + Date.now() + '.mp4');
  try {
    await youtubedl(fbUrl, {
      output: outPath,
      format: 'bv*+ba/b',
      mergeOutputFormat: 'mp4',
      noCheckCertificates: true,
      noWarnings: true,
      quiet: true,
      noPlaylist: true,
      retries: 3,
    });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20000) {
      let meta = {};
      try {
        meta = await youtubedl(fbUrl, {
          dumpSingleJson: true,
          noCheckCertificates: true,
          noWarnings: true,
          quiet: true,
          noPlaylist: true,
        });
      } catch (e) {}
      return {
        localPath: outPath,
        title: cleanTitle(meta?.title) || 'Facebook Video',
        description: meta?.description || null,
        author: meta?.uploader || meta?.channel || null,
        views: meta?.view_count || null,
        reactions: meta?.like_count || null,
        quality: 'HD',
        hasAudio: true
      };
    }
  } catch (e) {
    console.error('yt-dlp error:', e.message || e);
    if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch (e2) {}
  }
  return null;
}

// ========== ENGINE 3: fdown.isuru (yt-dlp based API) ==========
async function engineFdownApi(fbUrl) {
  try {
    const res = await fetch('https://fdown.isuru.eu.org/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl, quality: 'best' }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.download_url || data?.url || (data?.available_formats && data.available_formats[0]?.url);
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data?.video_info?.title || data?.title),
        author: data?.video_info?.uploader || null,
        views: data?.video_info?.view_count || null,
        quality: 'HD',
        hasAudio: true
      };
    }
  } catch (e) {}
  return null;
}

// ========== ENGINE 4-6: other fallbacks ==========
async function engineFbdownxyz(fbUrl) {
  try {
    const res = await fetch('https://api.fbdown.xyz/api?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.sd || data?.hd || data?.url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        views: data?.views || null,
        reactions: data?.likes || data?.reactions || null,
        quality: data?.sd ? 'SD' : 'HD'
      };
    }
  } catch (e) {}
  return null;
}

async function engineFdownnet(fbUrl) {
  try {
    const res = await fetch('https://fdown.net/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://fdown.net',
        'Referer': 'https://fdown.net/'
      },
      body: 'URLz=' + encodeURIComponent(fbUrl),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const sd = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Download in SD/i);
    const hd = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Download in HD/i);
    const videoUrl = (sd && sd[1]) || (hd && hd[1]);
    if (videoUrl && videoUrl.startsWith('http')) {
      return { url: videoUrl.replace(/&amp;/g, '&'), quality: sd ? 'SD' : 'HD' };
    }
  } catch (e) {}
  return null;
}

async function engineMediasaver(fbUrl) {
  try {
    const res = await fetch('https://mediasaver.link/api/?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.links?.sd || data?.video || data?.links?.hd || data?.url;
    if (videoUrl && String(videoUrl).startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        views: data?.views || null,
        reactions: data?.likes || data?.reactions || null,
        quality: data?.links?.sd ? 'SD' : 'HD'
      };
    }
  } catch (e) {}
  return null;
}

async function downloadToFile(url) {
  const tempPath = path.join('/tmp', 'fb_' + Date.now() + '.mp4');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.facebook.com/'
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error('Download failed: ' + res.status);
  const stream = fs.createWriteStream(tempPath);
  await pipeline(Readable.fromWeb(res.body), stream);
  if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 10000) {
    throw new Error('File too small');
  }
  return tempPath;
}

async function getBestVideo(fbUrl) {
  // Priority order for audio:
  // 1. Native FB progressive (browser_native_*) — usually has audio
  // 2. yt-dlp merge with ffmpeg
  // 3. fdown API (yt-dlp backend)
  // 4. Other scrapers

  const native = await engineNativeFb(fbUrl);
  if (native && native.url) {
    return { ...native, source: 'native' };
  }

  const ytdlp = await engineYtDlp(fbUrl);
  if (ytdlp && ytdlp.localPath) {
    return { ...ytdlp, source: 'ytdlp' };
  }

  const results = await Promise.allSettled([
    engineFdownApi(fbUrl),
    engineFbdownxyz(fbUrl),
    engineFdownnet(fbUrl),
    engineMediasaver(fbUrl)
  ]);

  let best = null;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && r.value.url) {
      if (!best) best = r.value;
      else if (r.value.hasAudio && !best.hasAudio) best = r.value;
      else if (r.value.title && !best.title) {
        best = { ...best, title: r.value.title, views: r.value.views || best.views, reactions: r.value.reactions || best.reactions };
      }
    }
  }
  return best;
}

async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);
  if (!match) return false;

  const fbUrl = match[0];
  const statusMsg = await client.sendMessage(chatId, {
    message: '⏳ **পাওয়ারফুল মোড চালু...**\nঅডিওসহ ভিডিও প্রস্তুত হচ্ছে ⚡',
    parseMode: 'md',
  });

  let localPath = null;

  try {
    const videoData = await getBestVideo(fbUrl);
    if (!videoData) throw new Error('No video found');

    if (videoData.localPath) {
      localPath = videoData.localPath;
    } else if (videoData.url) {
      localPath = await downloadToFile(videoData.url);
    } else {
      throw new Error('No downloadable source');
    }

    if (!videoData.title) videoData.title = 'Facebook Video';
    const caption = buildCaption(videoData);

    // Always upload local file → no stutter, reliable playback
    await client.sendFile(chatId, {
      file: localPath,
      caption: caption,
      supportsStreaming: true,
    });

    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });

    if (localPath && fs.existsSync(localPath)) {
      try { fs.unlinkSync(localPath); } catch (e) {}
    }
    return true;

  } catch (err) {
    console.error('Facebook Download Error:', err);
    if (localPath && fs.existsSync(localPath)) {
      try { fs.unlinkSync(localPath); } catch (e) {}
    }
    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **Facebook ভিডিও নামাতে সমস্যা হয়েছে।**\n\nসম্ভাব্য কারণ:\n• ভিডিওটি প্রাইভেট / রিস্ট্রিক্টেড\n• লিংকটি সঠিক নয়\n• সার্ভিস সাময়িকভাবে ডাউন\n\nঅনুগ্রহ করে **পাবলিক** ভিডিওর লিংক দিয়ে আবার চেষ্টা করুন।',
    });
    return true;
  }
}

module.exports = { handleFacebookDownload };
