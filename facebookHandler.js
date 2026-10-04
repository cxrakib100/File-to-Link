const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;

let youtubedl = null;
try {
  youtubedl = require('youtube-dl-exec');
} catch (e) {
  console.error('youtube-dl-exec not available');
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

// Primary: yt-dlp (best chance of video + audio together)
async function downloadWithYtDlp(fbUrl) {
  if (!youtubedl) return null;

  const outPath = path.join('/tmp', 'fb_ytdlp_' + Date.now() + '.mp4');

  try {
    // Prefer single-file mp4 with audio; fallback to best merge
    await youtubedl(fbUrl, {
      output: outPath,
      format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best',
      mergeOutputFormat: 'mp4',
      noCheckCertificates: true,
      noWarnings: true,
      quiet: true,
      restrictFilenames: true,
      noPlaylist: true,
    });

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      // Try get metadata
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
        comments: meta?.comment_count || null,
        quality: 'HD'
      };
    }
  } catch (e) {
    console.error('yt-dlp error:', e.message || e);
    if (fs.existsSync(outPath)) {
      try { fs.unlinkSync(outPath); } catch (e2) {}
    }
  }
  return null;
}

// Fallback scrapers
async function engine_fdownnet(fbUrl) {
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
    const sdMatch = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Download in SD/i)
      || html.match(/sdlink[^>]*href=["'](https?:\/\/[^"']+)/i);
    const hdMatch = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Download in HD/i)
      || html.match(/hdlink[^>]*href=["'](https?:\/\/[^"']+)/i);
    const videoUrl = (sdMatch && sdMatch[1]) || (hdMatch && hdMatch[1]);
    if (videoUrl && videoUrl.startsWith('http')) {
      return { url: videoUrl.replace(/&amp;/g, '&'), quality: sdMatch ? 'SD' : 'HD' };
    }
  } catch (e) {}
  return null;
}

async function engine_fbdownxyz(fbUrl) {
  try {
    const res = await fetch('https://api.fbdown.xyz/api?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.sd || data?.hd || data?.url || data?.download_url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        author: data?.author || null,
        views: data?.views || null,
        reactions: data?.likes || data?.reactions || null,
        quality: data?.sd ? 'SD' : 'HD'
      };
    }
  } catch (e) {}
  return null;
}

async function engine_mediasaver(fbUrl) {
  try {
    const res = await fetch('https://mediasaver.link/api/?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videoUrl = data?.links?.sd || data?.video || data?.links?.hd || data?.url || data?.download;
    if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
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

async function downloadUrlToFile(url) {
  const tempFilePath = path.join('/tmp', 'fb_' + Date.now() + '.mp4');
  const videoRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(45000)
  });
  if (!videoRes.ok) throw new Error('Download failed');
  const fileStream = fs.createWriteStream(tempFilePath);
  await pipeline(Readable.fromWeb(videoRes.body), fileStream);
  if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size < 5000) {
    throw new Error('File too small');
  }
  return tempFilePath;
}

async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);
  if (!match) return false;

  const fbUrl = match[0];

  const statusMsg = await client.sendMessage(chatId, {
    message: '⏳ **ভিডিও ডাউনলোড হচ্ছে...**\nঅডিওসহ প্রস্তুত করা হচ্ছে ⚡',
    parseMode: 'md',
  });

  let localPath = null;

  try {
    let videoData = {
      title: 'Facebook Video',
      description: null,
      author: null,
      views: null,
      reactions: null,
      quality: 'HD'
    };

    // 1) Try yt-dlp first (best for audio)
    const ytdlpResult = await downloadWithYtDlp(fbUrl);
    if (ytdlpResult && ytdlpResult.localPath) {
      localPath = ytdlpResult.localPath;
      videoData = { ...videoData, ...ytdlpResult };
    }

    // 2) Fallback scrapers → download full file (no remote stream = no stutter)
    if (!localPath) {
      const engines = [engine_fdownnet, engine_fbdownxyz, engine_mediasaver];
      const results = await Promise.allSettled(engines.map(fn => fn(fbUrl)));

      let remoteUrl = null;
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && r.value.url) {
          if (!remoteUrl) remoteUrl = r.value.url;
          if (r.value.title && !videoData.title) videoData.title = r.value.title;
          if (r.value.author && !videoData.author) videoData.author = r.value.author;
          if (r.value.views && !videoData.views) videoData.views = r.value.views;
          if (r.value.reactions && !videoData.reactions) videoData.reactions = r.value.reactions;
          if (r.value.quality) videoData.quality = r.value.quality;
        }
      }

      if (!remoteUrl) throw new Error('No video found');
      localPath = await downloadUrlToFile(remoteUrl);
    }

    const captionText = buildCaption(videoData);

    // Always send from local file → smooth playback, no stutter
    await client.sendFile(chatId, {
      file: localPath,
      caption: captionText,
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
