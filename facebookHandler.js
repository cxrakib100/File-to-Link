const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

let youtubedl = null;
try {
  youtubedl = require('youtube-dl-exec');
} catch (e) {}

// সংখ্যা ফরম্যাটিং (3.8M, 15K ইত্যাদি)
function formatNumber(num) {
  if (!num) return null;
  if (typeof num === 'string' && /[kKmM]/.test(num)) return num.toUpperCase();
  const n = Number(String(num).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return null;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.floor(n));
}

// 📅 আপলোডের তারিখ ও এক লাইনে সংক্ষিপ্ত বয়স হিসাব
function formatUploadDate(dateInput) {
  if (!dateInput) return null;
  let d;
  if (typeof dateInput === 'number' || /^\d{10,13}$/.test(dateInput)) {
    const ts = Number(dateInput);
    d = new Date(ts < 10000000000 ? ts * 1000 : ts);
  } else if (typeof dateInput === 'string' && /^\d{8}$/.test(dateInput)) {
    const y = dateInput.substring(0, 4);
    const m = dateInput.substring(4, 6);
    const day = dateInput.substring(6, 8);
    d = new Date(`${y}-${m}-${day}`);
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return null;

  const months = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  const day = d.getDate();
  const monthName = months[d.getMonth()];
  const year = d.getFullYear();
  const formattedDate = `${day} ${monthName} ${year}`;

  const now = new Date();
  const diffTime = Math.abs(now - d);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  let agoText = '';
  if (diffDays === 0) {
    agoText = 'আজকের ভিডিও';
  } else if (diffDays < 30) {
    agoText = `${diffDays} দিন`;
  } else if (diffDays < 365) {
    const monthsAgo = Math.floor(diffDays / 30);
    const remainDays = diffDays % 30;
    agoText = remainDays > 0 ? `${diffDays} দিন (${monthsAgo} মাস ${remainDays} দিন)` : `${diffDays} দিন (${monthsAgo} মাস)`;
  } else {
    const yearsAgo = Math.floor(diffDays / 365);
    const remainDays = diffDays % 365;
    const monthsAgo = Math.floor(remainDays / 30);
    agoText = `${diffDays} দিন (${yearsAgo} বছর ${monthsAgo} মাস)`;
  }

  return { date: formattedDate, ago: agoText };
}

// টাইটেল থেকে ক্রিয়েটর ও বাড়তি অংশ পরিষ্কার করা
function cleanTitle(t, author) {
  if (!t || typeof t !== 'string') return 'Facebook Reel';
  let s = t.trim()
    .replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*[·•|]\s*\d+(\.\d+)?[KkMm]?\s*reactions?\s*[·•|]?\s*/i, '')
    .replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*/i, '');

    // 🚫 এই লাইনটি যোগ করা হয়েছে: ডেসক্রিপশনের শুরুতে POV : বা POV থাকলে তা মুছে ফেলবে
  s = s.replace(/^POV\s*[:\-\s]\s*/i, '');
  
  // যদি টাইটেলের শেষে ক্রিয়েটরের নাম থাকে (| Bondi Pathshala School), তা মুছে ফেলা
  if (author && typeof author === 'string') {
    const cleanAuthor = author.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const authorRegex = new RegExp(`\\s*[|•·\\-–—]\\s*${cleanAuthor}\\s*$`, 'i');
    s = s.replace(authorRegex, '');
  }

  // Facebook বা Reel ট্যাগ থাকলে মোছা
  s = s.replace(/\s*[|•·\\-–—]\s*(?:Facebook|Reel|Reels|Watch)\s*$/i, '');

  if (s.length > 95) s = s.substring(0, 95).trim() + '...';
  return s.trim() || 'Facebook Reel';
}

// 🎨 আপনার রিকোয়ারমেন্ট অনুযায়ী পারফেক্ট সিঙ্গেল-লাইন ডিজাইন
function buildCaption(data) {
  let caption = '⚡ **ডাউনলোড সম্পন্ন হয়েছে!**\n\n';
  
  // ডেসক্রিপশন (ক্রিয়েটরের নাম ছাড়া ক্লিন)
  caption += '📝 **বিবরণ:** ' + (data.title || 'Facebook Video') + '\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';

  if (data.author) {
    caption += '👤 **ক্রিয়েটর:** ' + data.author + '\n';
  }
  if (data.views) {
    caption += '👁️ **মোট ভিউজ:** ' + formatNumber(data.views) + ' Views\n';
  }
  if (data.reactions) {
    caption += '❤️ **রিঅ্যাকশন:** ' + formatNumber(data.reactions) + ' Likes\n';
  }

  // 📅 তারিখ ও সংক্ষিপ্ত বয়স (এক লাইনে দেখাবে)
  const dateInfo = formatUploadDate(data.uploadDate);
  if (dateInfo) {
    caption += '📅 **আপলোড তারিখ:** ' + dateInfo.date + '\n';
    caption += '⏳ **বয়স:** ' + dateInfo.ago + '\n';
  }

  caption += '✨ **কোয়ালিটি:** ' + (data.quality || 'HD') + '\n';
  caption += '📱 **উৎস:** Facebook\n';
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
    return clean.replace(/\\u0025/g, '%').replace(/\\u0026/g, '&').replace(/\\//g, '/').replace(/\\"/g, '"');
  }
}

// পেজ মেটাডাটা ও পাওয়ারফুল লাইক স্ক্র্যাপার
function extractMetaFromHtml(html) {
  let meta = {};

  // ভিউজ
  const viewsMatch = html.match(/"play_count":\s*(\d+)/) || 
                     html.match(/"video_view_count":\s*(\d+)/) || 
                     html.match(/(\d+(?:\.\d+)?[KkMm]?)\s*views/i);
  if (viewsMatch) meta.views = viewsMatch[1];

  // রিঅ্যাকশন / লাইক (গ্যারান্টিড ক্যাচ)
  const reactMatch = html.match(/"reaction_count":\s*\{\s*"count":\s*(\d+)/) || 
                     html.match(/"reaction_count":\s*(\d+)/) ||
                     html.match(/"likers":\s*\{\s*"count":\s*(\d+)/) || 
                     html.match(/"like_count":\s*(\d+)/) ||
                     html.match(/(\d+(?:\.\d+)?[KkMm]?)\s*(?:reactions?|likes?)/i);
  if (reactMatch) meta.reactions = reactMatch[1];

  // ক্রিয়েটর
  const authorMatch = html.match(/Reel by ([^|•\n<]+)/i) || 
                      html.match(/"owner_name":\s*"([^"]+)"/) || 
                      html.match(/"name":\s*"([^"]+)"[^}]*"__typename":\s*"User"/);
  if (authorMatch) meta.author = authorMatch[1].trim();

  // টাইটেল (ক্রিয়েটর ফিল্টারসহ)
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i) || 
                     html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (titleMatch) meta.title = cleanTitle(titleMatch[1], meta.author);

  // আপলোডের সময়
  const timeMatch = html.match(/"publish_time":\s*(\d+)/) ||
                    html.match(/"creation_time":\s*(\d+)/) ||
                    html.match(/"uploadDate":\s*"([^"]+)"/) ||
                    html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"]+)"/i);
  if (timeMatch) meta.uploadDate = timeMatch[1];

  // ডিরেক্ট লিংক
  const hd = html.match(/"browser_native_hd_url"\s*:\s*("[^"]+")/) || html.match(/"playable_url_quality_hd"\s*:\s*("[^"]+")/);
  const sd = html.match(/"browser_native_sd_url"\s*:\s*("[^"]+")/) || html.match(/"playable_url"\s*:\s*("[^"]+")/);
  const match = hd || sd;
  if (match) {
    const vUrl = unescapeFb(match[1]);
    if (vUrl && vUrl.startsWith('http')) {
      meta.directUrl = vUrl;
      meta.quality = hd ? 'HD' : 'SD';
    }
  }

  return meta;
}

// লিঙ্ক রেজলভার
async function resolveFacebookLink(inputUrl) {
  let targetUrl = inputUrl.trim();
  let cachedMeta = {};

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(5000)
    });

    const html = await res.text();
    cachedMeta = extractMetaFromHtml(html);

    if (targetUrl.includes('/posts/') || targetUrl.includes('story.php') || targetUrl.includes('permalink.php')) {
      const nestedReel = html.match(/(?:https?:\/\/(?:www\.|m\.)?facebook\.com)?\/(?:share\/r\/|reel\/)([a-zA-Z0-9_-]+)/i);
      if (nestedReel) {
        let cleanNested = nestedReel[0];
        if (!cleanNested.startsWith('http')) cleanNested = 'https://www.facebook.com' + cleanNested;
        return { realUrl: cleanNested, cachedMeta };
      }
    }

    let finalUrl = res.url;
    if (finalUrl.includes('next=')) {
      try {
        const u = new URL(finalUrl);
        const next = u.searchParams.get('next');
        if (next) finalUrl = decodeURIComponent(next);
      } catch (e) {}
    }

    const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    if (canonicalMatch && canonicalMatch[1] && !canonicalMatch[1].includes('/share/')) {
      finalUrl = canonicalMatch[1];
    }

    return { realUrl: finalUrl.split('?')[0], cachedMeta };
  } catch (e) {
    return { realUrl: targetUrl.split('?')[0], cachedMeta };
  }
}

// 🚀 ENGINE 1: FDown API (Views, Likes সহ)
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
        title: cleanTitle(data?.video_info?.title || data?.title, data?.video_info?.uploader),
        author: data?.video_info?.uploader || null,
        views: data?.video_info?.view_count || null,
        reactions: data?.video_info?.like_count || null,
        uploadDate: data?.video_info?.upload_date || null,
        quality: 'HD'
      };
    }
    throw new Error();
  } catch {
    throw new Error('FDown Failed');
  }
}

// 🚀 ENGINE 2: Cobalt High-Speed API
async function engineCobalt(fbUrl) {
  try {
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl, videoQuality: '720', audioFormat: 'mp3' }),
      signal: AbortSignal.timeout(4500)
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

// 🚀 ENGINE 3: FBDown XYZ Mirror
async function engineFbdownxyz(fbUrl) {
  try {
    const res = await fetch('https://api.fbdown.xyz/api?url=' + encodeURIComponent(fbUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4500)
    });
    const data = await res.json();
    const videoUrl = data?.hd || data?.sd || data?.url;
    if (videoUrl && videoUrl.startsWith('http')) {
      return {
        url: videoUrl,
        title: cleanTitle(data.title),
        views: data?.views || null,
        reactions: data?.likes || data?.reactions || null,
        quality: data.hd ? 'HD' : 'SD'
      };
    }
    throw new Error();
  } catch {
    throw new Error('FbdownXYZ Failed');
  }
}

// 🚀 ENGINE 4: yt-dlp ফাস্ট ফলব্যাক
async function engineYtDlpFast(fbUrl) {
  if (!youtubedl) throw new Error('yt-dlp missing');
  const outPath = path.join(os.tmpdir(), 'fb_yt_' + Date.now() + '.mp4');
  try {
    await youtubedl(fbUrl, {
      output: outPath,
      format: 'b/best[ext=mp4]/best',
      noCheckCertificates: true,
      noWarnings: true,
      quiet: true,
      noPlaylist: true,
    });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20000) {
      return { localPath: outPath, title: 'Facebook Video', quality: 'HD' };
    }
  } catch (e) {
    if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch (e2) {}
  }
  throw new Error('yt-dlp failed');
}

// ⚡ প্যারালাল রেসিং
async function getFastestVideo(realFbUrl, cachedMeta) {
  if (cachedMeta && cachedMeta.directUrl) {
    return {
      url: cachedMeta.directUrl,
      title: cleanTitle(cachedMeta.title, cachedMeta.author),
      author: cachedMeta.author,
      views: cachedMeta.views,
      reactions: cachedMeta.reactions,
      uploadDate: cachedMeta.uploadDate,
      quality: cachedMeta.quality || 'HD'
    };
  }

  let videoResult = null;
  try {
    videoResult = await Promise.any([
      engineFdownApi(realFbUrl),
      engineCobalt(realFbUrl),
      engineFbdownxyz(realFbUrl)
    ]);
  } catch (err) {
    try {
      videoResult = await engineYtDlpFast(realFbUrl);
    } catch (e) {
      return null;
    }
  }

  if (videoResult) {
    videoResult.author = videoResult.author || cachedMeta.author || null;
    videoResult.title = cleanTitle(videoResult.title || cachedMeta.title || 'Facebook Video', videoResult.author);
    videoResult.views = videoResult.views || cachedMeta.views || null;
    videoResult.reactions = videoResult.reactions || cachedMeta.reactions || null;
    videoResult.uploadDate = videoResult.uploadDate || cachedMeta.uploadDate || null;
  }
  return videoResult;
}

// ⚡ ৫-১০ মিনিটের বড় ভিডিওর জন্য 4MB বাফারসহ আল্ট্রা-স্পিড ডাউনলোড
async function downloadFast(url) {
  const tempPath = path.join(os.tmpdir(), 'fb_' + Date.now() + '.mp4');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.facebook.com/'
    },
    signal: AbortSignal.timeout(240000) // ৪ মিনিট বরাদ্দ
  });
  if (!res.ok) throw new Error('Download failed');
  const stream = fs.createWriteStream(tempPath, { highWaterMark: 4 * 1024 * 1024 }); // 4MB বাফার
  await pipeline(Readable.fromWeb(res.body), stream);
  return tempPath;
}

// টেলিগ্রাম মেসেজ হ্যান্ডলার
async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);
  if (!match) return false;

  const rawUrl = match[0];
  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **আল্ট্রা-ফাস্ট প্রসেসিং চালু...**\nবিবরণ ও অডিওসহ ভিডিও প্রস্তুত হচ্ছে 🚀',
    parseMode: 'md',
  });

  let localPath = null;

  try {
    const { realUrl, cachedMeta } = await resolveFacebookLink(rawUrl);
    const videoData = await getFastestVideo(realUrl, cachedMeta);
    if (!videoData) throw new Error('Video source not found');

    if (videoData.localPath) {
      localPath = videoData.localPath;
    } else if (videoData.url) {
      localPath = await downloadFast(videoData.url);
    } else {
      throw new Error('No valid stream');
    }

    const caption = buildCaption(videoData);

    // 🚀 workers: 8 দিয়ে সর্বোচ্চ গতিতে প্যারালাল আপলোড
    await client.sendFile(chatId, {
      file: localPath,
      caption: caption,
      parseMode: 'md',
      workers: 8, // সর্বোচ্চ ৮টি প্যারালাল স্ট্রিম (১০ মিনিটের বড় ভিডিও সুপারফাস্ট আপলোড হবে)
      supportsStreaming: true,
    });

    try { await client.deleteMessages(chatId, [statusMsg.id], { revoke: true }); } catch (e) {}
    if (localPath && fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch (e) {}
    return true;

  } catch (err) {
    if (localPath && fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch (e) {}

    try {
      await client.editMessage(chatId, {
        message: statusMsg.id,
        text: '❌ **ভিডিও নামানো যায়নি!**\n\nপোস্টে কোনো পাবলিক ভিডিও পাওয়া যায়নি অথবা এটি রিমুভ করা হয়েছে। অন্য কোনো ভিডিওর লিংক দিয়ে চেষ্টা করুন।',
        parseMode: 'md',
      });
    } catch (e) {}
    return true;
  }
}

module.exports = { handleFacebookDownload };
