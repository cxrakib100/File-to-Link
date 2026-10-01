require('dotenv').config();
const express = require('express');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

// আলাদা করা মডিউলগুলো ইম্পোর্ট
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

// রঙিন বাটন (নীল ও লাল) পাঠানোর ফাংশন
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
              { text: "📁 File To Link Generate", style: "primary" }, // নীল বাটন
              { text: "▶️ YT Video Download", style: "danger" }       // লাল বাটন
            ]
          ],
          resize_keyboard: true,
          is_persistent: true
        }
      })
    });
  } catch (err) {
    console.error('Menu send error:', err);
  }
}

// টেক্সট ও বাটন ক্লিক হ্যান্ডলার
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message || message.media) return;

  const text = (message.text || '').trim();
  const senderId = message.senderId;
  const chatId = message.chatId;

  const joined = await isUserJoined(client, senderId);
  if (!joined) {
    await sendJoinPrompt(client, chatId, botUsername);
    return;
  }

  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'file');
    await sendColoredMenu(
      chatId,
      `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\nনিচের বাটন থেকে প্রয়োজনীয় সার্ভিস সিলেক্ট করুন:\n\n🔵 **File To Link Generate**\n🔴 **YT Video Download**`
    );
    return;
  }

  if (text === '📁 File To Link Generate' || text === '/file') {
    userModes.set(String(senderId), 'file');
    await sendColoredMenu(chatId, `📁 **ফাইল টু লিংক মোড সক্রিয়!**\n\nএখন যেকোনো ফাইল, পিডিএফ বা ছবি পাঠান।`);
    return;
  }

  if (text === '▶️ YT Video Download' || text === '/yt') {
    userModes.set(String(senderId), 'yt');
    await sendColoredMenu(chatId, `▶️ **ইউটিউব ডাউনলোড মোড সক্রিয়!**\n\nএখন ইউটিউব ভিডিওর লিংক পাঠান।`);
    return;
  }

  const isYtHandled = await handleYouTubeDownload(client, chatId, text);
  if (!isYtHandled) {
    const currentMode = userModes.get(String(senderId)) || 'file';
    if (currentMode === 'yt') {
      await message.reply({ message: '⚠️ অনুগ্রহ করে সঠিক ইউটিউব লিংক পাঠান (যেমন: https://youtu.be/...)' });
    } else {
      await message.reply({ message: '💡 যেকোনো ফাইল সেন্ড করুন অথবা নিচের বাটন চাপুন।' });
    }
  }
}, new NewMessage({ incoming: true }));

// ফাইল আসলে হ্যান্ডল করা (File To Link)
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message || !message.media) return;

  const senderId = message.senderId;
  const chatId = message.chatId;

  const joined = await isUserJoined(client, senderId);
  if (!joined) {
    await sendJoinPrompt(client, chatId, botUsername);
    return;
  }

  const currentMode = userModes.get(String(senderId)) || 'file';
  if (currentMode === 'yt') {
    await message.reply({ message: '⚠️ আপনি **ইউটিউব মোডে** আছেন! ফাইল আপলোড করতে নিচের নীল **"📁 File To Link Generate"** বাটনে চাপ দিন।' });
    return;
  }

  await processFileUpload(client, message);
}, new NewMessage({ incoming: true }));

// রাউট সেটআপ
setupDownloadRoute(app, client);
app.get('/', (req, res) => res.send('Multi-Function Bot Server is Live!'));

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
