const BOT_TOKEN = process.env.BOT_TOKEN;

// ইউটিউব থেকে সরাসরি MP4 ভিডিওর ডিরেক্ট লিংক বের করা
async function getFastVideoUrl(videoId, fullYtUrl) {
  // ১. ডেলিরিয়াস হাই-স্পিড ইঞ্জিন
  try {
    const res = await fetch(`https://delirius-apiofc.vercel.app/download/ytmp4?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      const dl = data.data?.download?.url || data.download?.url;
      if (dl) return { url: dl, title: data.data?.title || 'YouTube Video' };
    }
  } catch (e) {}

  // ২. সিপুতজেডএক্স ইঞ্জিন
  try {
    const res = await fetch(`https://api.siputzx.my.id/api/d/savefrom?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      const urls = data.data?.url || [];
      const best = urls.find(u => u.url && !u.no_audio) || urls[0];
      if (best?.url) return { url: best.url, title: data.data?.meta?.title || 'YouTube Video' };
    }
  } catch (e) {}

  // ৩. রাইজুমি ইঞ্জিন
  try {
    const res = await fetch(`https://api.ryzumi.net/api/downloader/all-in-one?url=${encodeURIComponent(fullYtUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      const dl = data.result?.video || data.result?.url;
      if (dl) return { url: dl, title: data.result?.title || 'YouTube Video' };
    }
  } catch (e) {}

  return null;
}

// মূল ফাংশন (টেলিগ্রাম ডিরেক্ট ক্লাউড পুশ)
async function handleYouTubeDownload(client, chatId, text) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const fullYtUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ইউটিউব থেকে ভিডিও আনা হচ্ছে... অনুগ্রহ করে ৫-১০ সেকেন্ড অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    const videoData = await getFastVideoUrl(videoId, fullYtUrl);

    if (!videoData || !videoData.url) {
      throw new Error('ভিডিও লিংক জেনারেট হয়নি');
    }

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **টেলিগ্রাম সার্ভার দিয়ে ভিডিও সরাসরি চ্যাটে পাঠানো হচ্ছে...**',
      parseMode: 'md',
    });

    // টেলিগ্রামের নিজস্ব সার্ভার সরাসরি URL থেকে ভিডিও নামিয়ে ইউজারের চ্যাটে পাঠাবে
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        video: videoData.url,
        caption: `🎬 **${videoData.title}**\n\n🔗 https://youtu.be/${videoId}`,
        supports_streaming: true
      }),
      signal: AbortSignal.timeout(25000) // ২৫ সেকেন্ডের বেশি কখনোই অপেক্ষা করবে না
    });

    const tgData = await tgRes.json();

    if (tgData.ok) {
      // সফলভাবে ভিডিও পাঠানো হলে আগের প্রসেসিং মেসেজটি ডিলিট করে দেওয়া হবে
      await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      return true;
    } else {
      throw new Error(tgData.description || 'টেলিগ্রাম ক্লাউড ভিডিও পাঠাতে পারেনি');
    }

  } catch (err) {
    console.error('YouTube Processing Error Details:', err);

    // কোনো কারণে আটকে গেলে ইউজার যাতে সাথে সাথে ১-ক্লিকে নামিয়ে নিতে পারে
    const fallbackLink = `https://y2mate.nu/en/download?url=${encodeURIComponent(fullYtUrl)}`;
    
    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `⚠️ **ভিডিওটি সরাসরি প্রসেস হতে দেরি হচ্ছে!**\n\nনিচের বাটনে চাপ দিয়ে সরাসরি হাই-কোয়ালিটি ভিডিও নামিয়ে নিতে পারেন:`,
      buttons: [
        [{ text: '📥 সরাসরি ১-ক্লিক ভিডিও ডাউনলোড', url: fallbackLink }]
      ],
      parseMode: 'md',
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
