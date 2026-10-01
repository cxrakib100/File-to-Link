require('dotenv').config();
const express = require('express');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const { isUserJoined, sendJoinPrompt } = require('./forceSub');
const { processFileUpload, setupDownloadRoute } = require('./fileHandler');
const { handleYouTubeDownload } = require('./ytHandler');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { connectionRetries: 5 });
const app = express();
let botUsername = '';

const userModes = new Map();

// আপনার মূল স্টাইলিশ বোল্ড ফন্টের বাটন মেনু
async function sendColoredMenu(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text: text,
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [
            [
              { text: "𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤", style: "success" },          // 🟢 গ্রিন ও বোল্ড ফন্ট
              { text: "𝐘𝐓 𝐕𝐢𝐝𝐞𝐨 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝", style: "danger" }   // 🔴 লাল ও বোল্ড ফন্ট
            ]
          ],
          resize_keyboard: true
        }
      })
    });
  } catch (err) {
    console.error('Menu send error:', err);
  }
}

// টেক্সট ও মেনু হ্যান্ডলার
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message) return;

  const text = (message.text || '').trim();
  const senderId = message.senderId;
  const chatId = message.chatId;

  // ১. চ্যানেল ভেরিফিকেশন
  const joined = await isUserJoined(client, senderId);
  if (!joined) {
    await sendJoinPrompt(client, chatId, botUsername);
    return;
  }

  // ২. /start কমান্ড
  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'file');
    await sendColoredMenu(
      chatId,
      `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\nনিচের মেনু থেকে সার্ভিস সিলেক্ট করুন:\n\n🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল, ছবি, ভিডিও লিংকে রূপান্তর করতে।\n🔴 **𝐘𝐓 𝐕𝐢𝐝𝐞𝐨 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝:** ইউটিউব ভিডিও সরাসরি ডাউনলোড করতে।`
    );
    return;
  }

  // ৩. বাটন ক্লিক হ্যান্ডলার (সব ধরনের ফন্ট সাপোর্ট)
  if (text.includes('𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤') || text.includes('File To Link') || text === '/file') {
    userModes.set(String(senderId), 'file');
    await sendColoredMenu(chatId, `🟢 **ফাইল টু লিংক মোড সক্রিয়!**\n\nএখন যেকোনো **ফাইল, পিডিএফ, ভিডিও বা ছবি (১০০ এমবি পর্যন্ত)** পাঠান। সরাসরি ১-ক্লিক ডাউনলোড লিংক তৈরি করে দেওয়া হবে।`);
    return;
  }

  if (text.includes('𝐘𝐓 𝐕𝐢𝐝𝐞𝐨 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝') || text.includes('YT Video Download') || text.includes('YouTube Video') || text === '/yt') {
    userModes.set(String(senderId), 'yt');
    await sendColoredMenu(chatId, `🔴 **ইউটিউব ডাউনলোড মোড সক্রিয়!**\n\nএখন আপনার কাঙ্ক্ষিত ইউটিউব ভিডিওর লিংক পাঠান। সরাসরি এই চ্যাটেই অডিও সহ ফুল এইচডি (1080p) ভিডিও পাঠিয়ে দেওয়া হবে।`);
    return;
  }

  // ৪. ইউটিউব লিংক আসলে সরাসরি ডাউনলোড ইঞ্জিন
  const isYouTubeLink = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/.test(text);

  if (isYouTubeLink) {
    await handleYouTubeDownload(client, chatId, text);
    return;
  }

  // ৫. ফাইল টু লিংক হ্যান্ডলার (এটি শুধুমাত্র আপনার চ্যানেলে ফরওয়ার্ড হবে)
  const hasRealFile = message.media && (message.media.document || message.media.photo);

  if (hasRealFile) {
    const currentMode = userModes.get(String(senderId)) || 'file';
    if (currentMode === 'yt') {
      await message.reply({ message: '⚠️ আপনি **ইউটিউব মোডে** আছেন! ফাইল আপলোড করতে নিচের সবুজ **"𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤"** বাটনে চাপ দিন।' });
      return;
    }

    await processFileUpload(client, message);
    return;
  }

  // অন্যান্য সাধারণ টেক্সটের ক্ষেত্রে
  const currentMode = userModes.get(String(senderId)) || 'file';
  if (currentMode === 'yt') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক ইউটিউব লিংক পাঠান (যেমন: https://youtu.be/...)' });
  } else {
    await message.reply({ message: '💡 যেকোনো ফাইল সেন্ড করুন অথবা নিচের মেনু বাটন চাপুন।' });
  }
}, new NewMessage({ incoming: true }));

// ডাউনলোড রাউট সেটআপ
setupDownloadRoute(app, client);
app.get('/', (req, res) => res.send('Multi-Function Bot Server is Live!'));

// সেলফ-পিং
setInterval(() => {
  if (BASE_URL) fetch(BASE_URL).catch(() => {});
}, 8 * 60 * 1000);

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  const me = await client.getMe();
  botUsername = me.username;
  console.log(`বট @${botUsername} সফলভাবে চালু হয়েছে!`);
});
