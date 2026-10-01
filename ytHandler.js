const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ১. কোবাল্ট আল্ট্রাফাস্ট ক্লাস্টার (১৬টি সার্ভার)
const COBALT_SERVERS = [
  'https://cobalt.meowing.de',
  'https://co.wuk.sh',
  'https://cobalt.canine.tools',
  'https://co.meow.gb.net',
  'https://co.tskau.team',
  'https://api.co.rooot.gay',
  'https://capi.oak.li',
  'https://cobalt.synzr.space',
  'https://api-dl.cgm.rs',
  'https://cobalt.api.timelessnesses.me',
  'https://cobalt-api.hyper.lol',
  'https://co.kelig.me',
  'https://nyc1.coapi.ggtyler.dev',
  'https://cal1.coapi.ggtyler.dev',
  'https://par1.coapi.ggtyler.dev',
  'https://cobalt-api.ayo.tf'
];

// ২. ইনভিডিয়াস গ্লোবাল ক্লাস্টার (৮টি সার্ভার)
const INVIDIOUS_SERVERS = [
  'inv.nadeko.net',
  'invidious.nerdvpn.de',
  'invidious.private.coffee',
  'yt.artemislena.eu',
  'invidious.jing.rocks',
  'invidious.drgns.space',
  'invidious.lunar.icu',
  'yewtu.be'
];

// ২৫+ এপিআই দিয়ে দ্রুত ভিডিও লিংক পাওয়ার ইঞ্জিন
async function getDirectVideoUrl(fullYtUrl, videoId) {
  // ইঞ্জিন ১: Cobalt ক্লাস্টার টেস্ট (৪ সেকেন্ড টাইমআউট দিয়ে ফাস্ট স্কিপ)
  for (const server of COBALT_SERVERS) {
    try {
      const res = await fetch(`${server}/`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        body: JSON.stringify({
          url: fullYtUrl,
          videoQuality: '1080',
          downloadMode: 'auto'
        }),
        signal: AbortSignal.timeout(4000) // ৪ সেকেন্ডের মধ্যে রেসপন্স না দিলে পরেরটায় যাবে
      });

      if (res.ok) {
        const data = await res.json();
        const streamUrl = data.url || (data.picker && data.picker[0]?.url);
        if (streamUrl) return { url: streamUrl, title: 'YouTube Video' };
      }
    } catch (e) {
      continue;
    }
  }

  // ইঞ্জিন ২: Invidious ক্লাস্টার টেস্ট
  for (const host of INVIDIOUS_SERVERS) {
    try {
      const res = await fetch(`https://${host}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000)
      });

      if (res.ok) {
        const data = await res.json();
        const formats = data.formatStreams?.reverse() || [];
        const chosen = formats.find(f => f.url && f.container === 'mp4') || formats[0];
        if (chosen?.url) return { url: chosen.url, title: data.title || 'YouTube Video' };
      }
    } catch (e) {
      continue;
    }
  }

  // ইঞ্জিন ৩: ব্যাকআপ REST এপিআই
  try {
    const res = await fetch(`https://delirius-apiofc.vercel.app/download/ytmp4?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      const dl = data.data?.download?.url || data.download?.url;
      if (dl) return { url: dl, title: data.data?.title || 'YouTube Video' };
    }
  } catch (e) {}

  try {
    const res = await fetch(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      const urls = data.data?.url || data.result?.url || data.data || [];
      const videoObj = Array.isArray(urls) 
        ? urls.find(u => u.url && (u.ext === 'mp4' || u.type?.includes('mp4') || !u.no_audio)) || urls[0]
        : null;
      if (videoObj?.url) return { url: videoObj.url, title: data.data?.meta?.title || 'YouTube Video' };
    }
  } catch (e) {}

  return null;
}

// মূল ফাংশন
async function handleYouTubeDownload(client, chatId, text) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const fullYtUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ইউটিউব থেকে অডিও সহ ফুল এইচডি ভিডিও প্রসেস করা হচ্ছে... অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    const videoData = await getDirectVideoUrl(fullYtUrl, videoId);

    if (!videoData || !videoData.url) {
      throw new Error('কোনো ইঞ্জিন থেকেই ভিডিও লিংক পাওয়া যায়নি');
    }

    const tempFilePath = path.join('/tmp', `yt_${videoId}_${Date.now()}.mp4`);
    const streamRes = await fetch(videoData.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!streamRes.ok) throw new Error('ভিডিও ফাইল ডাউনলোড করা যায়নি');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(streamRes.body), fileStream);

    const stats = fs.statSync(tempFilePath);
    if (stats.size === 0) throw new Error('ফাইল শূন্য এসেছে');

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **ভিডিও সফলভাবে তৈরি হয়েছে! আপনার টেলিগ্রাম চ্যাটে পাঠানো হচ্ছে...**',
      parseMode: 'md',
    });

    // শুধুমাত্র ইউজারের চ্যাটেই ভিডিও পাঠানো হচ্ছে (চ্যানেলে যাবে না)
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **${videoData.title}**\n\n🔗 https://youtu.be/${videoId}`,
      supportsStreaming: true,
    });

    // ডিলিট ও ক্লিনআপ
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;
  } catch (err) {
    console.error('YouTube Processing Error Details:', err);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ **ভিডিওটি নামাতে সাময়িক সমস্যা হয়েছে। অনুগ্রহ করে আবার লিংকটি পাঠান।**',
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
