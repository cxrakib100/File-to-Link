const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

let youtubedl = null;
try {
  youtubedl = require('youtube-dl-exec');
} catch (e) {}

function cleanTitle(t) {
  if (!t || typeof t !== 'string') return 'Facebook Reel';
  let s = t.trim()
    .replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*[·•|]\s*\d+(\.\d+)?[KkMm]?\s*reactions?\s*[·•|]?\s*/i, '')
    .replace(/^\d+(\.\d+)?[KkMm]?\s*views?\s*/i, '');
  if (s.length > 100) s = s.substring(0, 100).trim() + '...';
  return s || 'Facebook Reel';
}

function buildCaption(data) {
  let caption = '⚡ **ডাউনলোড সম্পন্ন (অডিওসহ)!**\n\n';
  caption += '🎬 **' + (data.title || 'Facebook Video') + '**\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '✨ **কোয়ালিটি:** ' + (data.quality || 'HD (Clear Audio)') + '\n';
  caption += '📱 **উৎস:** Facebook\n';
  caption += '━━━━━━━━━━━━━━━━━━━━\n';
  caption += '⚡ **Power By Cx_Rakib**';
  return caption;
}

// 🔗 ১. ফেসবুক শর্ট লিঙ্ককে আসল লিঙ্কে রূপান্তর (share/r, share/v, fb.watch Fix)
async function expandFacebookUrl(shortUrl) {
  try {
    const res = await fetch(shortUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(6000)
    });

    let finalUrl = res.url;
    // যদি লগইন পেজে রিডাইরেক্ট করে, তাহলে ভেতরে থাকা আসল লিঙ্ক বের করা
    if (finalUrl.includes('next=')) {
      try {
        const u = new URL(finalUrl);
        const next = u.searchParams.get('next');
        if (next) return decodeURIComponent(next);
      } catch (e) {}
    }

    if (finalUrl && !finalUrl.includes('/share/')) {
      return finalUrl.split('?')[0]; // ক্লিন লিঙ্ক
    }

    // পেজের মেটাডাটা থেকে অরিজিনাল লিঙ্ক খোঁজা
    const html = await res.text();
    const match = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i) ||
                  html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return match[1].split('?')[0];
    }
  } catch (err) {}
  return shortUrl;
}

// 🚀 ENGINE 1: FDown Isuru API (অডিও মার্জ করা ফাইল দেয়)
async function engineFdownApi(fbUrl) {
  try {
    const res = await fetch('https://fdown.isuru.eu.org/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fbUrl, quality: 'best' }),
      signal: AbortSignal.timeout(6000)
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

// 🚀 ENGINE 2: Cobalt High-Speed API
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
        videoQuality: '720',
        audioFormat: 'mp3'
      }),
      signal: AbortSignal.timeout(6000)
    });
    const data = await res.json();
    if (data && data.url) {
      return { url: data.url, title: 'Facebook Reel', quality: 'HD' };
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
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    // সাউন্ড থাকার নিশ্চয়তার জন্য SD বা HD প্রিফার করা
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

// 🚀 ENGINE 4: yt-dlp ফলব্যাক (যদি সব এপিআই মিস করে, সাউন্ডসহ গ্যারান্টিড ডাউনলোড)
async function engineYtDlpFast(fbUrl) {
  if (!youtubedl) throw new Error('yt-dlp missing');
  const outPath = path.join(os.tmpdir(), 'fb_yt_' + Date.now() + '.mp4');
  try {
    await youtubedl(fbUrl, {
      output: outPath,
      format: 'b/best[ext=mp4]/best', // b বা best দিলে আলাদা মার্জিং ছাড়াও সরাসরি অডিও+ভিডিও আসে
      noCheckCertificates: true,
      noWarnings: true,
      quiet: true,
      noPlaylist: true,
    });

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20000) {
      return { localPath: outPath, title: 'Facebook Reel', quality: 'HD' };
    }
  } catch (e) {
    if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch (e2) {}
  }
  throw new Error('yt-dlp failed');
}

// ⚡ প্যারালাল রেসিং ইঞ্জিন
async function getFastestVideo(realFbUrl) {
  try {
    // একসাথে দ্রুততম এপিআইগুলোতে ট্রাই করা
    return await Promise.any([
      engineFdownApi(realFbUrl),
      engineCobalt(realFbUrl),
      engineFbdownxyz(realFbUrl)
    ]);
  } catch (err) {
    // যদি অনলাইন এপিআই ব্লক থাকে, ব্যাকআপ হিসেবে লোকাল ইঞ্জিন চালাবে
    try {
      return await engineYtDlpFast(realFbUrl);
    } catch (e) {
      return null;
    }
  }
}

// সুপারফাস্ট ফাইল স্ট্রিম
async function downloadFast(url) {
  const tempPath = path.join(os.tmpdir(), 'fb_' + Date.now() + '.mp4');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.facebook.com/'
    },
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) throw new Error('Download failed');
  const stream = fs.createWriteStream(tempPath, { highWaterMark: 1024 * 1024 });
  await pipeline(Readable.fromWeb(res.body), stream);
  return tempPath;
}

// মূল ফাংশন
async function handleFacebookDownload(client, chatId, text) {
  const fbRegex = /(https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+)/i;
  const match = text.match(fbRegex);
  if (!match) return false;

  const rawUrl = match[0];
  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **লিংক প্রসেসিং হচ্ছে...**\nঅডিওসহ রিল প্রস্তুত করা হচ্ছে 🚀',
    parseMode: 'md',
  });

  let localPath = null;

  try {
    // ১. প্রথমে শর্টলিঙ্ককে আসল ফেসবুক লিঙ্কে বদলে নেওয়া হচ্ছে
    const realFbUrl = await expandFacebookUrl(rawUrl);

    // ২. আল্ট্রা-ফাস্ট অডিও+ভিডিও ফেচ করা
    const videoData = await getFastestVideo(realFbUrl);
    if (!videoData) throw new Error('Video source not found');

    if (videoData.localPath) {
      localPath = videoData.localPath;
    } else if (videoData.url) {
      localPath = await downloadFast(videoData.url);
    } else {
      throw new Error('No valid stream');
    }

    const caption = buildCaption(videoData);

    // ৩. টেলিগ্রামে সরাসরি আপলোড
    await client.sendFile(chatId, {
      file: localPath,
      caption: caption,
      parseMode: 'md',
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
        text: '❌ **ভিডিও নামানো যায়নি!**\n\nভিডিওটি প্রাইভেট অথবা রিমুভ করা হয়েছে। অন্য কোনো পাবলিক ভিডিও বা রিলের লিংক দিন।',
        parseMode: 'md',
      });
    } catch (e) {}
    return true;
  }
}

module.exports = { handleFacebookDownload };
