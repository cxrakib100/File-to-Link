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

// অটোমেটিক্যালি রঙিন বাটন কিবোর্ড সহ মেসেজ পাঠানোর ফাংশন
async function sendColoredMenu(chatId, text) {
  try {
    const cleanId = String(chatId).replace(/[^0-9-]/g, '');
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanId,
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

// ১. ইনলাইন ভেরিফিকেশন হ্যান্ডলার (অটোমেটিক্যালি ইন্টারফেস ওপেন করবে)
client.addEventHandler(async (update) => {
  if (update.className === 'UpdateBotCallbackQuery') {
    const data = update.data ? update.data.toString() : '';

    if (data === 'check_sub') {
      const senderId = update.userId;
      const joined = await isUserJoined(client, senderId);

      if (joined) {
        // চাকার ঘূর্ণন শেষ করা
        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '✅ ভেরিফিকেশন সফল হয়েছে!',
            alert: false,
          })
        );

        // আগের জয়েন প্রম্পট মেসেজটি মুছে দেওয়া যাতে চ্যাট পরিষ্কার থাকে
        try {
          await client.deleteMessages(update.peer, [update.msgId], { revoke: true });
        } catch (e) {}

        // কোনো স্টার্ট ছাড়াই সাথে সাথে অটোমেটিক্যালি রঙিন বাটন ইন্টারফেস পাঠিয়ে দেওয়া
        userModes.set(String(senderId), 'file');
        await sendColoredMenu(
          senderId,
          `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\n⚡ **বটের সব সার্ভিস এখন সম্পূর্ণ সক্রিয়!**\n\nনিচের বাটন থেকে প্রয়োজনীয় কাজটি বেছে নিন:\n🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল, ছবি, ভিডিও সরাসরি লিংকে রূপান্তর করতে।\n🔴 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ওয়াটারমার্ক ছাড়া ডাউনলোড করতে।`
        );

      } else {
        // জয়েন না করলে ওখানেই আটকে থাকবে এবং ওয়ার্নিং অ্যালার্ট দেবে
        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '⚠️ আপনি এখনো চ্যানেলে জয়েন করেননি! দয়া করে আগে চ্যানেলে জয়েন করুন।',
            alert: true,
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
      `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\n⚡ **বটের সব সার্ভিস এখন সম্পূর্ণ সক্রিয়!**\n\nনিচের বাটন থেকে প্রয়োজনীয় কাজটি বেছে নিন:\n🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল, ছবি, ভিডিও সরাসরি লিংকে রূপান্তর করতে।\n🔴 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ওয়াটারমার্ক ছাড়া ডাউনলোড করতে।`
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

  // সাধারণ টেক্সটের ক্ষেত্রে
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
