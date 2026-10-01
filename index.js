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

// আপনার কাঙ্ক্ষিত গ্রিন, ব্লু ও রেড বাটন কিবোর্ড
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
              { text: "𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤", style: "success" },          // 🟢 গ্রিন বাটন (১ম লাইন বামে)
              { text: "𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨", style: "primary" }           // 🔵 ব্লু বাটন (১ম লাইন ডানে)
            ],
            [
              { text: "𝐒𝐮𝐩𝐩𝐨𝐫𝐭", style: "danger" }                 // 🔴 রেড বাটন (সবার নিচে)
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
async function sendBackMenu(chatId, text) {
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
    console.error('sendBackMenu error:', err);
  }
}

// ১. ইনলাইন ভেরিফিকেশন হ্যান্ডলার
client.addEventHandler(async (update) => {
  if (update.className === 'UpdateBotCallbackQuery') {
    const data = update.data ? update.data.toString() : '';

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
          `🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**\n\n⚡ **বটের সব সার্ভিস এখন সম্পূর্ণ সক্রিয়!**\n\nনিচের বাটন থেকে প্রয়োজনীয় কাজটি বেছে নিন:`
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

  // /start কমান্ড দিলে প্রধান মেনু দেখানো
  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'main');
    await sendMainMenu(
      chatId,
      `🏠 **প্রধান মেনু — File To Link & Media Hub**\n━━━━━━━━━━━━━━━━━━━━━━\nবটের সব সার্ভিস সক্রিয়! নিচের বাটন থেকে নির্বাচন করুন:\n\n🟢 **𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤:** ফাইল সরাসরি লিংকে রূপান্তর করতে।\n🔵 **𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨:** টিকটক ভিডিও ওয়াটারমার্ক ছাড়া ডাউনলোড করতে।\n🔴 **𝐒𝐮𝐩𝐩𝐨𝐫𝐭:** অ্যাডমিনের সাথে সরাসরি যোগাযোগ করতে।\n━━━━━━━━━━━━━━━━━━━━━━`
    );
    return;
  }

  // বাটন ১: 𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤 (গ্রিন বাটন)
  if (text.includes('𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤') || text.includes('File To Link') || text === '/file') {
    userModes.set(String(senderId), 'file');
    await sendBackMenu(
      chatId,
      `📁 **ফাইল টু লিংক সার্ভিস সক্রিয় হয়েছে!**\n━━━━━━━━━━━━━━━━━━━━━━\n📥 **কীভাবে ব্যবহার করবেন:**\nআমাকে যেকোনো **ফাইল, পিডিএফ, ভিডিও বা ছবি (১০০ এমবি পর্যন্ত)** পাঠান।\n\n⚡ সাথে সাথে একটি সরাসরি ১-ক্লিক ডাউনলোড লিংক তৈরি করে দেওয়া হবে।\n\n🔙 *প্রধান মেনুতে ফিরে যেতে চাইলে নিচের '🔙 𝐁𝐚𝐜𝐤' বাটন চাপুন।*\n━━━━━━━━━━━━━━━━━━━━━━`
    );
    return;
  }

  // বাটন ২: 𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨 (ব্লু বাটন)
  if (text.includes('𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨') || text.includes('Tiktok Video') || text === '/tiktok') {
    userModes.set(String(senderId), 'tiktok');
    await sendBackMenu(
      chatId,
      `🎬 **টিকটক ভিডিও ডাউনলোডার সক্রিয় হয়েছে!**\n━━━━━━━━━━━━━━━━━━━━━━\n📥 **কীভাবে ব্যবহার করবেন:**\nআপনার কাঙ্ক্ষিত টিকটক ভিডিওর লিংকটি এখানে পেস্ট করে সেন্ড করুন।\n\n✨ কোনো ওয়াটারমার্ক ছাড়া সরাসরি হাই-কোয়ালিটি ভিডিও এই চ্যাটেই পেয়ে যাবেন।\n\n🔙 *প্রধান মেনুতে ফিরে যেতে চাইলে নিচের '🔙 𝐁𝐚𝐜𝐤' বাটন চাপুন।*\n━━━━━━━━━━━━━━━━━━━━━━`
    );
    return;
  }

  // বাটন ৩: 𝐒𝐮𝐩𝐩𝐨𝐫𝐭 (রেড বাটন - সরাসরি প্রি-ফিল্ড মেসেজ সহ লিংক)
  if (text.includes('𝐒𝐮𝐩𝐩𝐨𝐫𝐭') || text.includes('Support')) {
    const prefillText = encodeURIComponent('আসসালামু আলাইকুম ভাইয়া!');
    const supportUrl = `https://t.me/cx_rakib?text=${prefillText}`;

    await client.sendMessage(chatId, {
      message: 
`👨‍💻 **অ্যাডমিন সাপোর্ট ও সহায়তা কেন্দ্র**
━━━━━━━━━━━━━━━━━━━━━━
যেকোনো সমস্যা, প্রশ্ন বা সহায়তার জন্য সরাসরি অ্যাডমিনের সাথে যোগাযোগ করতে পারেন।

👇 **নিচের বাটনে ক্লিক করুন** 👇`,
      buttons: [
        [Button.url('💬 অ্যাডমিনকে মেসেজ পাঠান', supportUrl)]
      ],
      parseMode: 'md',
    });
    return;
  }

  // বাটন ৪: '🔙 𝐁𝐚𝐜𝐤' চাপলে
  if (text.includes('𝐁𝐚𝐜𝐤') || text.includes('Back') || text === '/back') {
    userModes.set(String(senderId), 'main');
    await sendMainMenu(
      chatId,
      `🏠 **প্রধান মেনু**\n━━━━━━━━━━━━━━━━━━━━━━\nনিচের বাটন থেকে প্রয়োজনীয় সার্ভিসটি বেছে নিন:`
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
