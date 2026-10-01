const { Button } = require('telegram/tl/custom/button');

async function handleYouTubeDownload(client, chatId, text) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];
  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const ytDlUrlVideo = `https://y2mate.nu/en/download?url=${encodeURIComponent(cleanUrl)}`;
  const ytDlUrlAudio = `https://y2mate.nu/en/mp3?url=${encodeURIComponent(cleanUrl)}`;

  await client.sendMessage(chatId, {
    message: 
`🎬 **ইউটিউব ভিডিও প্রস্তুত!**

🔗 **ভিডিও আইডি:** \`${videoId}\`

নিচের বাটনে ক্লিক করে সরাসরি হাই-কোয়ালিটি ভিডিও বা অডিও ডাউনলোড করে নিন:`,
    buttons: [
      [Button.url('📥 ডাউনলোড ভিডিও (HD/MP4)', ytDlUrlVideo)],
      [Button.url('🎵 ডাউনলোড অডিও (MP3)', ytDlUrlAudio)]
    ],
    parseMode: 'md',
  });

  return true;
}

module.exports = { handleYouTubeDownload };
