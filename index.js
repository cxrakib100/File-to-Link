require('dotenv').config();
const express = require('express');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Button } = require('telegram/tl/custom/button');

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

// প্রধান মেনুর রঙিন বাটন কিবোর্ড
async function sendMainMenu(chatId, text) {
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
    console.error('sendMainMenu error:', err);
  }
}

// সাব-মেনু কিবোর্ড (নিচে ব্যাক বাটন)
async function sendBackKeyboard(chatId, text) {
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
              { text: "🔙 𝐁𝐚𝐜𝐤", style: "danger" }
            ]
          ],
          resize_keyboard: true
        }
      })
    });
  } catch (err) {
    console.error('sendBackKeyboard error:', err);
  }
}

// ১. ইনলাইন বাটন ইভেন্ট (ভেরিফিকেশন এবং গোল চাকা ঘুরিয়ে স্মুথ ব্যাক)
client.addEventHandler(async (update) => {
  if (update.className === 'UpdateBotCallbackQuery') {
    const data = update.data ? update.data.toString() : '';

    // ক) চ্যানেল ভেরিফিকেশন বাটন
    if (data === 'check_sub') {
      const senderId = update.userId;
      const joined = await isUserJoined(client, senderId);

      if (joined) {
        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '✅ ভেরিফিকেশন সফল হয়েছে!',
            alert: false,
          })
        );

        try {
          await client.deleteMessages(update.peer, [update.msgId], { revoke: true });
        } catch (e) {}

        userModes.set(String(senderId), 'main');
        await sendMainMenu(
          senderId,
          `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\n⚡ **বটের সব সার্ভিস এখন সম্পূর্ণ সক্রিয়!**\n\nনিচের বাটন থেকে প্রয়োজনীয় কাজটি বেছে নিন:\n🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল, ছবি, ভিডিও সরাসরি লিংকে রূপান্তর করতে।\n🔴 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ওয়াটারমার্ক ছাড়া ডাউনলোড করতে।`
        );

      } else {
        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '⚠️ আপনি এখনো চ্যানেলে জয়েন করেননি! দয়া করে আগে চ্যানেলে জয়েন করুন।',
            alert: true,
          })
        );
      }
    }

    // খ) স্মুথ ব্যাক বাটন (চাকার মতো ঘুরবে এবং মেসেজ কোনো লেখা ছাড়া নিজে থেকেই হোমস্ক্রিনে ফিরবে)
    if (data === 'smooth_back') {
      const senderId = update.userId;
      userModes.set(String(senderId), 'main');

      // গোল চাকার ঘূর্ণন শেষ করা
      await client.invoke(
        new Api.messages.SetBotCallbackAnswer({
          queryId: update.queryId,
          message: 'হোমস্ক্রিনে ফিরে যাওয়া হচ্ছে...',
        })
      );

      // কোনো মেসেজ টাইপ না হয়ে স্মুথলি আগের মেসেজটি হোমস্ক্রিন হয়ে যাবে
      try {
        await client.editMessage(update.peer, {
          message: update.msgId,
          text: `🏠 **প্রধান মেনু**\n\nনিচের মেনু বাটন থেকে আপনার সার্ভিস বেছে নিন:`,
          buttons: undefined, // ইনলাইন বাটন রিমুভ
          parseMode: 'md',
        });
      } catch (e) {}

      // প্রধান মেনুর বাটন দুটি নিচে ফেরত আনা
      await sendMainMenu(
        senderId,
        `🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল লিংকে রূপান্তর করতে।\n🔴 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ডাউনলোড করতে।`
      );
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

  // /start কমান্ড
  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'main');
    await sendMainMenu(
      chatId,
      `🎉 **স্বাগতম!**\n\nনিচের বাটন থেকে প্রয়োজনীয় সার্ভিস সিলেক্ট করুন:\n\n🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল, ছবি, ভিডিও সরাসরি লিংকে রূপান্তর করতে।\n🔴 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ওয়াটারমার্ক ছাড়া ডাউনলোড করতে।`
    );
    return;
  }

  // বাটন ১: 𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤 চাপলে
  if (text.includes('𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤') || text.includes('File To Link') || text === '/file') {
    userModes.set(String(senderId), 'file');
    
    // মেসেজের সাথেই ইনলাইন ব্যাক বাটন যুক্ত থাকবে যা চাপলে চাকা ঘুরবে এবং স্মুথ ব্যাক নেবে
    await client.sendMessage(chatId, {
      message: `🟢 **ফাইল টু লিংক মোড সক্রিয় হয়েছে!**\n\nএখন যেকোনো **ফাইল, পিডিএফ, ভিডিও বা ছবি (১০০ এমবি পর্যন্ত)** পাঠান। সরাসরি ১-ক্লিক ডাউনলোড লিংক তৈরি করে দেওয়া হবে।`,
      buttons: [
        [Button.inline('🔙 𝐁𝐚𝐜𝐤', Buffer.from('smooth_back'))] // ইনলাইন স্পিনিং ব্যাক বাটন
      ],
      parseMode: 'md',
    });

    await sendBackKeyboard(chatId, '💡 যেকোনো সময় হোমস্ক্রিনে ফিরতে ব্যাক বাটন চাপুন।');
    return;
  }

  // বাটন ২: 𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨 চাপলে
  if (text.includes('𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨') || text.includes('Tiktok Video') || text === '/tiktok') {
    userModes.set(String(senderId), 'tiktok');
    
    await client.sendMessage(chatId, {
      message: `🔴 **টিকটক ডাউনলোড মোড সক্রিয় হয়েছে!**\n\nএখন যেকোনো টিকটক ভিডিওর লিংক পাঠান। সরাসরি এই চ্যাটেই ওয়াটারমার্ক ছাড়া ফুল এইচডি ভিডিও পাঠিয়ে দেওয়া হবে।`,
      buttons: [
        [Button.inline('🔙 𝐁𝐚𝐜𝐤', Buffer.from('smooth_back'))] // ইনলাইন স্পিনিং ব্যাক বাটন
      ],
      parseMode: 'md',
    });

    await sendBackKeyboard(chatId, '💡 যেকোনো সময় হোমস্ক্রিনে ফিরতে ব্যাক বাটন চাপুন।');
    return;
  }

  // কীবোর্ডের '🔙 𝐁𝐚𝐜𝐤' বাটনে চাপ দিলে
  if (text.includes('𝐁𝐚𝐜𝐤') || text.includes('Back') || text === '/back') {
    userModes.set(String(senderId), 'main');
    await sendMainMenu(
      chatId,
      `🔙 **প্রধান মেনুতে ফিরে আসা হয়েছে!**\n\nনিচের বাটন থেকে প্রয়োজনীয় কাজটি বেছে নিন:`
    );
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
      await message.reply({ message: '⚠️ আপনি **টিকটক মোডে** আছেন! ফাইল আপলোড করতে নিচে **"🔙 𝐁𝐚𝐜𝐤"** বাটনে চাপ দিয়ে **"𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤"** সিলেক্ট করুন।' });
      return;
    }

    await processFileUpload(client, message);
    return;
  }

  // সাধারণ টেক্সটের ক্ষেত্রে
  const currentMode = userModes.get(String(senderId)) || 'main';
  if (currentMode === 'tiktok') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক টিকটক ভিডিওর লিংক পাঠান (যেমন: https://vt.tiktok.com/...)' });
  } else {
    await message.reply({ message: '💡 যেকোনো ফাইল সেন্ড করুন অথবা নিচের মেনু বাটন ব্যবহার করুন।' });
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
