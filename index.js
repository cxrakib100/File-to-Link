require('dotenv').config();
const express = require('express');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

// মডিউলসমূহ
const { isUserJoined, sendJoinPrompt } = require('./forceSub');
const { processFileUpload, setupDownloadRoute } = require('./fileHandler');
const { handleTikTokDownload } = require('./tiktokHandler');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { connectionRetries: 5 });
const app = express();
let botUsername = '';

const userModes = new Map();

// আপনার স্টাইলিশ বোল্ড ফন্ট ও রঙিন বাটন
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
              { text: "𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤", style: "success" },          // 🟢 গ্রিন বাটন
              { text: "𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨", style: "danger" }           // 🔴 লাল বাটন
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

// ১. ইনলাইন বাটন ভেরিফিকেশন (চাকার মতো ঘুরবে ও অ্যালার্ট দেবে)
client.addEventHandler(async (update) => {
  if (update.className === 'UpdateBotCallbackQuery') {
    const data = update.data ? update.data.toString() : '';

    if (data === 'check_sub') {
      const senderId = update.userId;
      const joined = await isUserJoined(client, senderId);

      if (joined) {
        // চাকার ঘূর্ণন শেষ করে সাকসেস মেসেজ দেওয়া
        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '✅ ভেরিফিকেশন সফল হয়েছে!',
            alert: false,
          })
        );

        // আগের মেসেজটি পরিবর্তন করে স্বাগতম মেসেজ বসানো (নতুন কোনো স্টার্ট হবে না)
        try {
          await client.editMessage(update.peer, {
            message: update.msgId,
            text: 
`🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**

⚡ **বটের সব সার্ভিস এখন সক্রিয়!**
নিচের মেনু বাটন ব্যবহার করে আপনার প্রয়োজনীয় কাজটি বেছে নিন।`,
            parseMode: 'md',
          });
        } catch (e) {}

        // রঙিন বাটনগুলো নিচে পাঠিয়ে দেওয়া
        userModes.set(String(senderId), 'file');
        await sendColoredMenu(
          update.peer,
          `🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ১০০ এমবি পর্যন্ত ফাইল সরাসরি ডাউনলোডের লিংক বানাতে।\n🔴 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ওয়াটারমার্ক ছাড়া সরাসরি ডাউনলোড করতে।`
        );

      } else {
        // জয়েন না করলে চাকার ঘূর্ণন শেষে পপ-আপ অ্যালার্ট দেওয়া
        // মেসেজটি নড়বে না, ওখানেই আটকে থাকবে!
        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '⚠️ আপনি এখনো চ্যানেলে জয়েন করেননি! দয়া করে আগে চ্যানেলে জয়েন করুন।',
            alert: true, // স্ক্রিনে স্পষ্ট ওয়ার্নিং পপ-আপ ভাসবে
          })
        );
      }
    }
  }
});

// ২. টেক্সট ও মেনু হ্যান্ডলার
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message) return;

  const text = (message.text || '').trim();
  const senderId = message.senderId;
  const chatId = message.chatId;

  // চ্যানেল ভেরিফিকেশন
  const joined = await isUserJoined(client, senderId);
  if (!joined) {
    await sendJoinPrompt(client, chatId);
    return;
  }

  // /start কমান্ড দিলে
  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'file');
    await sendColoredMenu(
      chatId,
      `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\nনিচের মেনু থেকে প্রয়োজনীয় সার্ভিস সিলেক্ট করুন:\n\n🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল, ছবি, ভিডিও লিংকে রূপান্তর করতে।\n🔴 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ওয়াটারমার্ক ছাড়া সরাসরি ডাউনলোড করতে।`
    );
    return;
  }

  // বাটন ক্লিক হ্যান্ডলার
  if (text.includes('𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤') || text.includes('File To Link') || text === '/file') {
    userModes.set(String(senderId), 'file');
    await sendColoredMenu(chatId, `🟢 **ফাইল টু লিংক মোড সক্রিয় হয়েছে!**\n\nএখন যেকোনো **ফাইল, পিডিএফ, ভিডিও বা ছবি (১০০ এমবি পর্যন্ত)** পাঠান। সরাসরি ১-ক্লিক ডাউনলোড লিংক তৈরি করে দেওয়া হবে।`);
    return;
  }

  if (text.includes('𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨') || text.includes('Tiktok Video') || text === '/tiktok') {
    userModes.set(String(senderId), 'tiktok');
    await sendColoredMenu(chatId, `🔴 **টিকটক ডাউনলোড মোড সক্রিয় হয়েছে!**\n\nএখন যেকোনো টিকটক ভিডিওর লিংক পাঠান। সরাসরি এই চ্যাটেই ওয়াটারমার্ক ছাড়া ফুল এইচডি ভিডিও পাঠিয়ে দেওয়া হবে।`);
    return;
  }

  // টিকটক লিংক আসলে সরাসরি ডাউনলোড
  const isTikTokLink = /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)\//.test(text);
  if (isTikTokLink) {
    await handleTikTokDownload(client, chatId, text);
    return;
  }

  // ফাইল টু লিংক হ্যান্ডলার
  const hasRealFile = message.media && (message.media.document || message.media.photo);
  if (hasRealFile) {
    const currentMode = userModes.get(String(senderId)) || 'file';
    if (currentMode === 'tiktok') {
      await message.reply({ message: '⚠️ আপনি **টিকটক মোডে** আছেন! ফাইল আপলোড করতে নিচের সবুজ **"𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤"** বাটনে চাপ দিন।' });
      return;
    }

    await processFileUpload(client, message);
    return;
  }

  // অন্যান্য সাধারণ টেক্সটের ক্ষেত্রে
  const currentMode = userModes.get(String(senderId)) || 'file';
  if (currentMode === 'tiktok') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক টিকটক ভিডিওর লিংক পাঠান (যেমন: https://vt.tiktok.com/...)' });
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
  console.log(`Server listening on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  const me = await client.getMe();
  botUsername = me.username;
  console.log(`বট @${botUsername} সফলভাবে চালু হয়েছে!`);
});
