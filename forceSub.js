const { Api } = require('telegram');
const { Button } = require('telegram/tl/custom/button');

const FORCE_CHANNEL = 'Mrincomeboss';
const FORCE_CHANNEL_URL = 'https://t.me/Mrincomeboss';

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

async function sendJoinPrompt(client, chatId, botUsername) {
  const verifyUrl = botUsername 
    ? `https://t.me/${botUsername}?start=verify`
    : FORCE_CHANNEL_URL;

  const text = 
`⚠️ **প্রবেশাধিকার সীমিত!**

বটটি ব্যবহার করতে হলে আপনাকে অবশ্যই আমাদের অফিশিয়াল চ্যানেলে যুক্ত হতে হবে। নিচের বাটনে ক্লিক করে চ্যানেলে জয়েন করুন, তারপর **'🔄 ভেরিফাই করুন'** বাটনে চাপ দিন।`;

  const buttons = [
    [Button.url('📢 Join Our Channel', FORCE_CHANNEL_URL)],
    [Button.url('🔄 ভেরিফাই করুন (Check)', verifyUrl)]
  ];

  await client.sendMessage(chatId, {
    message: text,
    buttons: buttons,
    parseMode: 'md',
  });
}

module.exports = { isUserJoined, sendJoinPrompt };
