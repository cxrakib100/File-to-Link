const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

// ইউটিউব ভিডিও সরাসরি টেলিগ্রামে ডাউনলোড ও পাঠানোর ইঞ্জিন
async function handleYouTubeDownload(client, chatId, text) {
  // ইউটিউব লিংক ডিটেকশন
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const fullYtUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const statusMsg = await client.sendMessage(chatId, {
    message: '⏳ **ইউটিউব থেকে ভিডিও প্রসেস করা হচ্ছে... অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।**',
    parseMode: 'md',
  });

  try {
    // Cobalt API দিয়ে সরাসরি সেরা কোয়ালিটির ভিডিও স্ট্রিম নিয়ে আসা
    const apiRes = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: fullYtUrl,
        vQuality: '1080', // ফুল এইচডি চেষ্টা করবে
      })
    });

    const data = await apiRes.json();

    if (!data || (!data.url && !data.picker)) {
      throw new Error('ভিডিও ডাউনলোডের ডিরেক্ট স্ট্রিম পাওয়া যায়নি');
    }

    const downloadStreamUrl = data.url || data.picker[0].url;

    // টেম্পোরারি ফাইলে ভিডিও সেভ করা
    const tempFilePath = path.join('/tmp', `yt_${videoId}_${Date.now()}.mp4`);
    const videoStreamRes = await fetch(downloadStreamUrl);
    
    if (!videoStreamRes.ok) throw new Error('ভিডিও স্ট্রিমে ত্রুটি হয়েছে');

    const fileStream = fs.createWriteStream(tempFilePath);
    await pipeline(videoStreamRes.body, fileStream);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '📤 **ভিডিও প্রস্তুত! টেলিগ্রামে আপলোড করা হচ্ছে...**',
      parseMode: 'md',
    });

    // সরাসরি ইউজারের চ্যাটে ভিডিও পাঠানো (চ্যানেলে ফরওয়ার্ড হবে না)
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: `🎬 **ইউটিউব ভিডিও সফলভাবে ডাউনলোড হয়েছে!**\n\n🔗 **লিংক:** https://youtu.be/${videoId}`,
      supportsStreaming: true,
    });

    // মেসেজ ডিলিট ও টেম্পোরারি ফাইল ক্লিনআপ
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return true;
  } catch (err) {
    console.error('YouTube Processing Error:', err);

    // ব্যাকআপ উপায়: যদি ভিডিও সাইজ অনেক বড় হয় বা সরাসরি পাঠাতে সার্ভারে লোড বেশি পড়ে
    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `⚠️ **ভিডিওটি অনেক বড় হওয়ায় সরাসরি টেলিগ্রামে পাঠানো যায়নি!**\n\nনিচের লিংকে ক্লিক করে সরাসরি হাই-কোয়ালিটিতে ডাউনলোড করে নিতে পারেন:\n👉 https://y2mate.nu/en/download?url=${encodeURIComponent(fullYtUrl)}`,
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
