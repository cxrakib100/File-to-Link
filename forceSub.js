const { Api } = require('telegram');
const { Button } = require('telegram/tl/custom/button');

const FORCE_CHANNEL = 'Mrincomeboss';
const FORCE_CHANNEL_URL = 'https://t.me/Mrincomeboss';

// ইউজার চ্যানেলে জয়েন আছে কিনা চেক করা
async function isUserJoined(client, userId) {
  try {
    const res = await client.invoke(
      new Api.channels.GetParticipant({
        channel: FORCE_CHANNEL,
        participant: userId,
      })
    );
    return !!res;
  } catch (err) {
    return false;
  }
}

// জয়েন না থাকলে ইনলাইন বাটন পাঠানো (কোনো রিডাইরেক্ট লিংক ছাড়া পিওর বাটন)
async function sendJoinPrompt(client, chatId) {
  const text = 
`⚠️ **প্রবেশাধিকার সীমিত!**

বটটি ব্যবহার করতে হলে আপনাকে অবশ্যই আমাদের অফিশিয়াল চ্যানেলে যুক্ত হতে হবে। নিচের বাটনে ক্লিক করে চ্যানেলে জয়েন করুন, তারপর **'🔄 ভেরিফাই করুন'** বাটনে চাপ দিন।`;

  const buttons = [
    [Button.url('📢 Join Our Channel', FORCE_CHANNEL_URL)],
    [Button.inline('🔄 ভেরিফাই করুন (Check)', Buffer.from('check_sub'))] // পিওর কলব্যাক বাটন (তীর চিহ্ন ছাড়া)
  ];

  await client.sendMessage(chatId, {
    message: text,
    buttons: buttons,
    parseMode: 'md',
  });
}

module.exports = { isUserJoined, sendJoinPrompt, FORCE_CHANNEL };
