const { Button } = require('telegram/tl/custom/button');

// ইউটিউব হ্যান্ডলার (টেলিগ্রাম প্রিভিউ ডিটেকশন ও ১-ক্লিক ডিরেক্ট ডাউনলোড)
async function handleYouTubeDownload(client, chatId, text, message) {
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);

  if (!ytMatch) return false;

  const videoId = ytMatch[1];

  // টেলিগ্রামের নিজস্ব প্রিভিউ থেকে টাইটেল নেওয়া
  let videoTitle = 'YouTube Video';
  if (message && message.media && message.media.webpage) {
    videoTitle = message.media.webpage.title || videoTitle;
  }

  // সরাসরি নো-অ্যাড ডিরেক্ট হাই-স্পিড MP4 স্ট্রিম লিংক
  // এটিতে ক্লিক করা মাত্র ব্রাউজারে কোনো পেজ ছাড়াই সরাসরি ফাইল ডাউনলোড শুরু হয়ে যাবে
  const direct720p = `https://yewtu.be/latest_version?id=${videoId}&itag=22`;
  const direct360p = `https://yewtu.be/latest_version?id=${videoId}&itag=18`;
  const directAudio = `https://yewtu.be/latest_version?id=${videoId}&itag=140`;

  // ব্যাকআপ সুপারফাস্ট মিরর
  const fastMirror = `https://co.wuk.sh/`;

  await client.sendMessage(chatId, {
    message: 
`🎬 **${videoTitle}**

🔗 **ভিডিও আইডি:** \`${videoId}\`

নিচের বাটনে চাপ দেওয়া মাত্র কোনো বিজ্ঞাপন ছাড়াই **সরাসরি আপনার মোবাইলে ভিডিও ডাউনলোড হওয়া শুরু হবে:**`,
    buttons: [
      [Button.url('📥 ১-ক্লিকে ডাউনলোড (720p HD)', direct720p)],
      [Button.url('📥 ১-ক্লিকে ডাউনলোড (360p Normal)', direct360p)],
      [Button.url('🎵 ১-ক্লিকে ডাউনলোড (Audio/MP3)', directAudio)]
    ],
    parseMode: 'md',
  });

  return true;
}

module.exports = { handleYouTubeDownload };
