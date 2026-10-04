const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

let youtubedl = null;
try {
  youtubedl = require('youtube-dl-exec');
} catch (e) {}

const FB_CRAWLER_HEADERS = {
  'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

// সংখ্যা ফরম্যাটিং
function formatNumber(num) {
  if (!num) return null;
  if (typeof num === 'string' && /[kKmM]/.test(num)) return num.toUpperCase();
  const n = Number(String(num).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return null;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.floor(n));
}

// 📅 এক লাইনে কমপ্যাক্ট তারিখ ফরম্যাট (কখনই লাইন ভাঙবে না)
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

  // সংক্ষিপ্ত মাসের নাম (যাতে মোবাইলে লাইন না ভাঙে)
  const shortMonths = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ', 'অক্টো', 'নভে', 'ডিসে'];
  const day = d.getDate();
  const monthName = shortMonths[d.getMonth()];
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

// টাইটেল ফিল্টার ও POV ক্লিন
function cleanTitle(t, author) {
  if (!t || typeof t !== 'string') return 'Facebook Reel';
  let s = t.trim()
    .replace(/&#xb7;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*[·•|]?\s*/i, '')
    .replace(/^\d+(\.\d+)?[KkMm]?\s*reactions?\s*[·•|]?\s*/i, '')
    .replace(/^POV\s*[:\-\s]\s*/i, ''); // POV ফিল্টার

  if (author && typeof author === 'string') {
    const cleanAuthor = author.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\s*[|•·\\-–—]\\s*${cleanAuthor}\\s*$`, 'i'), '');
  }

  s = s.replace(/\s*[|•·\\-–—]\s*(?:Facebook|Reel|Reels|Watch)\s*$/i, '');
  if (s.length > 90) s = s.substring(0, 90).trim() + '...';
  return s.trim() || 'Facebook Reel';
}

// 🎯 ফেসবুকের লম্বা og:title থেকে ভিউ, লাইক, টাইটেল ও ক্রিয়েটর আলাদা করা
function parseFacebookOgTitle(ogTitle) {
  if (!ogTitle) return {};
  let str = ogTitle
    .replace(/&#xb7;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const parts = str.split('|').map(p => p.trim()).filter(Boolean);
  let res = {};

  if (parts.length >= 3) {
    const vMatch = parts[0].match(/(\d+(?:\.\d+)?[KkMm]?)\s*views/i);
    if (vMatch) res.views = vMatch[1];

    const rMatch = parts[0].match(/(\d+(?:\.\d+)?[KkMm]?)\s*reactions?/i);
    if (rMatch) res.reactions = rMatch[1];

    res.title = parts[1];
    res.author = parts[parts.length - 1]; // একদম শেষের অংশ আসল ক্রিয়েটর
  } else if (parts.length === 2) {
    res.title = parts[0];
    res.author = parts[1];
  } else if (parts.length === 1) {
    const reelBy = parts[0].match(/Reel by\s+(.+)/i);
    if (reelBy) res.author = reelBy[1].trim();
    else res.title = parts[0];
  }

  if (res.author) {
    res.author = res.author.replace(/\s*[-–|•]\s*Facebook$/i, '').trim();
  }
  return res;
}

// 🎨 আপনার চাহিদা অনুযায়ী নিখুঁত সিঙ্গেল-লাইন ও সেন্ট্রাল ডিজাইন
function buildVideoCaption(data) {
  let caption = '⚡ **ডাউনলোড সম্পন্ন হয়েছে!**\n\n';
  caption += '📝 **বিবরণ:** ' + (data.title || 'Facebook Video') + '\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';

  if (data.author) caption += '👤 **ক্রিয়েটর:** ' + data.author + '\n';
  if (data.views) caption += '👁️ **মোট ভিউজ:** ' + formatNumber(data.views) + ' Views\n';
  if (data.reactions) caption += '❤️ **রিঅ্যাকশন:** ' + formatNumber(data.reactions) + ' Likes\n';

  const dateInfo = formatUploadDate(data.uploadDate);
  if (dateInfo) {
    caption += '📅 **তারিখ:** ' + dateInfo.date + '\n';
    caption += '⏳ **বয়স:** ' + dateInfo.ago + '\n';
  }

  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '✨ **কোয়ালিটি:** ' + (data.quality || 'HD') + '\n';
  caption += '📱 **উৎস:** Facebook\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  // ✨ সেন্ট্রাল এলাইনমেন্ট ডিজাইন
  caption += '       ⚡ **Power By Cx_Rakib** ⚡';

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

// পেজ স্ক্র্যাপার
function extractMetaFromHtml(html) {
  let meta = {};

  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    const parsed = parseFacebookOgTitle(ogTitleMatch[1]);
    meta = { ...parsed };
  }

  // ভিউজ
  if (!meta.views) {
    const vm = html.match(/"play_count":\s*(\d+)/) || html.match(/"video_view_count":\s*(\d+)/) || html.match(/(\d+(?:\.\d+)?[KkMm]?)\s*views/i);
    if (vm) meta.views = vm[1];
  }

  // লাইক
  if (!meta.reactions) {
    const rm = html.match(/"reaction_count":\s*\{\s*"count":\s*(\d+)/) || html.match(/"likers":\s*\{\s*"count":\s*(\d+)/) || html.match(/(\d+(?:\.\d+)?[KkMm]?)\s*likes/i);
    if (rm) meta.reactions = rm[1];
  }

  // ক্রিয়েটর
  if (!meta.author) {
    const am = html.match(/Reel by ([^|•\n<]+)/i) || html.match(/"owner_name":\s*"([^"]+)"/) || html.match(/"name":\s*"([^"]+)"[^}]*"__typename":\s*"User"/);
    if (am) meta.author = am[1].trim();
  }

  // টাইটেল
  const tm = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) || html.match(/<title>([^<]+)<\/title>/i);
  if (tm && (!meta.title || meta.title === 'Facebook Reel')) {
    meta.title = tm[1];
  }

  meta.title = cleanTitle(meta.title, meta.author);

  // আপলোড তারিখ
  const timeMatch = html.match(/"publish_time":\s*(\d+)/) ||
                    html.match(/"creation_time":\s*(\d+)/) ||
                    html.match(/"uploadDate":\s*"([^"]+)"/) ||
                    html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"]+)["']/i);
  if (timeMatch) meta.uploadDate = timeMatch[1];

  // প্রিভিউ ছবি
  const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (imgMatch) meta.image = imgMatch[1].replace(/&amp;/g, '&');

  // ডিরেক্ট লিঙ্ক
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
      headers: FB_CRAWLER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(5000)
    });

    const html = await res.text();
    cachedMeta = extractMetaFromHtml(html);

    const nestedMatch = html.match(/https?:\/\/(?:www\.|m\.)?facebook\.com\/(?:share\/[rv]\/|reel\/|watch\/\?v=)[a-zA-Z0-9_-]+/i) ||
                        html.match(/(?:share\/[rv]\/|reel\/)([a-zA-Z0-9_-]+)/i);

    if (nestedMatch) {
      let nested = nestedMatch[0];
      if (!nested.startsWith('http')) nested = 'https://www.facebook.com/' + nested;
      return { realUrl: nested, cachedMeta, isVideo: true };
    }

    let finalUrl = res.url.split('?')[0];
    const isVideo = !!(cachedMeta.directUrl || finalUrl.includes('/reel/') || finalUrl.includes('/videos/') || finalUrl.includes('watch'));
    return { realUrl: finalUrl, cachedMeta, isVideo };

  } catch (e) {
    return { realUrl: targetUrl.split('?')[0], cachedMeta, isVideo: false };
  }
}

// 🚀 ENGINE 1: FDown API
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

// 🚀 ENGINE 4: yt-dlp ফাস্ট ব্যাকআপ
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
    videoResult.author = cachedMeta.author || videoResult.author || null;
    videoResult.title = cleanTitle(videoResult.title || cachedMeta.title || 'Facebook Video', videoResult.author);
    videoResult.views = cachedMeta.views || videoResult.views || null;
    videoResult.reactions = cachedMeta.reactions || videoResult.reactions || null;
    videoResult.uploadDate = cachedMeta.uploadDate || videoResult.uploadDate || null;
  }
  return videoResult;
}

// ⚡ ৪MB বাফারের সাথে সুপার ফাস্ট ডাউনলোডার
async function downloadFast(url) {
  const tempPath = path.join(os.tmpdir(), 'fb_' + Date.now() + '.mp4');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.facebook.com/'
    },
    signal: AbortSignal.timeout(240000)
  });
  if (!res.ok) throw new Error('Download failed');
  const stream = fs.createWriteStream(tempPath, { highWaterMark: 4 * 1024 * 1024 });
  await pipeline(Readable.fromWeb(res.body), stream);
  return tempPath;
}

// মূল হ্যান্ডলার
async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);
  if (!match) return false;

  const rawUrl = match[0];
  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ভিডিও ডাউনলোড হচ্ছে...**\nদয়া করে একটু অপেক্ষা করুন 🚀\n━━━━━━━━━━━━━━━━━━━━\n🔍 অডিও ও সেরা কোয়ালিটি প্রস্তুত করা হচ্ছে...',
    parseMode: 'md',
  });

  let localPath = null;

  try {
    const { realUrl, cachedMeta } = await resolveFacebookLink(rawUrl);
    const videoData = await getFastestVideo(realUrl, cachedMeta);

    if (videoData && (videoData.localPath || videoData.url)) {
      if (videoData.localPath) {
        localPath = videoData.localPath;
      } else {
        localPath = await downloadFast(videoData.url);
      }

      const caption = buildVideoCaption(videoData);

      // 🚀 workers: 8 দিয়ে সর্বোচ্চ গতিতে আপলোড
      await client.sendFile(chatId, {
        file: localPath,
        caption: caption,
        parseMode: 'md',
        workers: 8,
        supportsStreaming: true,
      });

      try { await client.deleteMessages(chatId, [statusMsg.id], { revoke: true }); } catch (e) {}
      if (localPath && fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch (e) {}
      return true;
    }

    throw new Error('No video stream');

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
