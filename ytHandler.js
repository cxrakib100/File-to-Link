const { Button } = require('telegram/tl/custom/button');

// ইউটিউব ডাউনলোডার হ্যান্ডলার
async function handleYouTubeDownload(client, chatId, text) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const statusMsg = await client.sendMessage(chatId, {
    message: '⚡ **ইউটিউব ভিডিও পাওয়া গেছে! ডাউনলোড বাটন প্রস্তুত করা হচ্ছে...**',
    parseMode: 'md',
  });

  try {
    // সরাসরি দ্রুতগতির ডাউনলোড গেটওয়ে লিংক
    const dl1080p = `https://y2mate.nu/en/download?url=${encodeURIComponent(cleanUrl)}`;
    const dl720p = `https://ssyoutube.com/en795/youtube-video-downloader?url=${encodeURIComponent(cleanUrl)}`;
    const dlMp3 = `https://y2mate.nu/en/mp3?url=${encodeURIComponent(cleanUrl)}`;

    // ইউজারের চ্যাটে সুন্দর বাটন সহ পাঠানো
    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: 
`🎬 **ইউটিউব ভিডিও প্রস্তুত!**

🔗 **ভিডিও আইডি:** \`${videoId}\`
📺 **কোয়ালিটি:** 1080p Full HD / 720p HD

নিচের যেকোনো বাটনে ক্লিক করে সরাসরি অডিও সহ সম্পূর্ণ ভিডিওটি আপনার ফোনে নামিয়ে নিন:`,
      buttons: [
        [Button.url('📥 ডাউনলোড ১০৮০p (Full HD)', dl1080p)],
        [Button.url('📥 ডাউনলোড ৭২০p (HD)', dl720p)],
        [Button.url('🎵 ডাউনলোড অডিও (MP3)', dlMp3)]
      ],
      parseMode: 'md',
    });

    return true;
  } catch (err) {
    console.error('YouTube Button Error:', err);
    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: '❌ ভিডিও প্রসেস করতে সাময়িক সমস্যা হয়েছে। লিংকটি আবার পাঠান।',
    });
    return true;
  }
}

module.exports = { handleYouTubeDownload };
