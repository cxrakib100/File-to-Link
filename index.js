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

// স্ক্রিনশটের মতো গ্রিন ও রেড স্টাইলিশ বাটন
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
              { text: "File To Link", style: "success" },          // 🟢 গ্রিন বাটন
              { text: "YouTube Video Download", style: "danger" }   // 🔴 লাল বাটন
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

// মূল মেসেজ হ্যান্ডলার
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message) return;

  const text = (message.text || '').trim();
  const senderId = message.senderId;
  const chatId = message.chatId;

  // ১. চ্যানেল ভেরিফিকেশন চেক
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
      `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\nনিচের মেনু থেকে প্রয়োজনীয় সার্ভিস সিলেক্ট করুন:\n\n🟢 **File To Link:** ফাইল, ছবি, ভিডিও লিংকে রূপান্তর করতে।\n🔴 **YouTube Video Download:** ইউটিউব ভিডিও ডাউনলোড করতে।`
    );
    return;
  }

  // ৩. বাটন হ্যান্ডলার
  if (text === 'File To Link' || text === '📁 File To Link Generate' || text === '/file') {
    userModes.set(String(senderId), 'file');
    await sendColoredMenu(chatId, `🟢 **ফাইল টু লিংক মোড সক্রিয় হয়েছে!**\n\nএখন যেকোনো **ফাইল, পিডিএফ, ভিডিও বা ছবি (১০০ এমবি পর্যন্ত)** পাঠান। সরাসরি ১-ক্লিক ডাউনলোড লিংক তৈরি করে দেওয়া হবে।`);
    return;
  }

  if (text === 'YouTube Video Download' || text === '▶️ YT Video Download' || text === '/yt') {
    userModes.set(String(senderId), 'yt');
    await sendColoredMenu(chatId, `🔴 **ইউটিউব ডাউনলোড মোড সক্রিয় হয়েছে!**\n\nএখন আপনার কাঙ্ক্ষিত ইউটিউব ভিডিওর লিংক পাঠান। সরাসরি এই চ্যাটেই ভিডিও পাঠিয়ে দেওয়া হবে।`);
    return;
  }

  // ৪. ইউটিউব লিংক আসলে (লিংক প্রিভিউ থাকলেও যেন টেক্সট হিসেবে কাজ করে)
  const isYouTubeLink = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/.test(text);

  if (isYouTubeLink) {
    await handleYouTubeDownload(client, chatId, text);
    return;
  }

  // ৫. ফাইল টু লিংক হ্যান্ডলার (ডকুমেন্ট, আসল ভিডিও ফাইল বা ছবি আসলে)
  const hasRealFile = message.media && (message.media.document || message.media.photo);

  if (hasRealFile) {
    const currentMode = userModes.get(String(senderId)) || 'file';
    if (currentMode === 'yt') {
      await message.reply({ message: '⚠️ আপনি বর্তমানে **ইউটিউব মোডে** আছেন! ফাইল আপলোড করতে নিচের সবুজ **"File To Link"** বাটনে চাপ দিন।' });
      return;
    }

    // এটি শুধু চ্যানেলে ফরওয়ার্ড হবে এবং ডাউনলোড লিংক তৈরি হবে
    await processFileUpload(client, message);
    return;
  }

  // অন্য কোনো টেক্সট লিখলে
  const currentMode = userModes.get(String(senderId)) || 'file';
  if (currentMode === 'yt') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক ইউটিউব লিংক পাঠান (যেমন: https://youtu.be/...)' });
  } else {
    await message.reply({ message: '💡 যেকোনো ফাইল, পিডিএফ বা ভিডিও সেন্ড করুন অথবা নিচের মেনু বাটন চাপুন।' });
  }
}, new NewMessage({ incoming: true }));

// ডাউনলোড রাউট
setupDownloadRoute(app, client);
app.get('/', (req, res) => res.send('Multi-Function Bot Server is Live!'));

// সেলফ-পিং
setInterval(() => {
  if (BASE_URL) fetch(BASE_URL).catch(() => {});
}, 8 * 60 * 1000);

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  const me = await client.getMe();
  botUsername = me.username;
  console.log(`বট @${botUsername} সফলভাবে চালু হয়েছে!`);
});
