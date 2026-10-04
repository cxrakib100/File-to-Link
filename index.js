require('dotenv').config();
const express = require('express');
const https = require('https');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Button } = require('telegram/tl/custom/button');

// Modules
const { isUserJoined, sendJoinPrompt } = require('./forceSub');
const { processFileUpload, setupDownloadRoute } = require('./fileHandler');
const { handleTikTokDownload } = require('./tiktokHandler');
const { handleFacebookDownload } = require('./facebookHandler');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { 
  connectionRetries: 10,
  autoReconnect: true,
  useWSS: false
});

const app = express();
let botUsername = '';
const userModes = new Map();
const userTimeouts = new Map();
const TWO_HOURS = 2 * 60 * 60 * 1000;

const httpAgent = new https.Agent({ 
  keepAlive: true, 
  keepAliveMsecs: 30000, 
  maxSockets: 50,
  maxFreeSockets: 20
});

function sendFastTelegramRequest(endpoint, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = https.request(`https://api.telegram.org/bot${BOT_TOKEN}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      agent: httpAgent
    }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  });
}

const subCache = new Map();
const SUB_CACHE_TTL = 5 * 60 * 1000;

async function checkSubWithSpeed(userId) {
  const cached = subCache.get(String(userId));
  if (cached && (Date.now() - cached.time < SUB_CACHE_TTL)) {
    return cached.joined;
  }
  const joined = await isUserJoined(client, userId);
  subCache.set(String(userId), { joined, time: Date.now() });
  return joined;
}

const MAIN_MENU_TEXT = 
`🏠 𝐌𝐚𝐢𝐧 𝐌𝐞𝐧𝐮
━━━━━━━━━━━━━━━━━━━━━━
✨ নিচের বাটন থেকে আপনার
প্রয়োজনীয় সার্ভিসটি বেছে নিন।
━━━━━━━━━━━━━━━━━━━━━━`;

const FILE_SERVICE_TEXT = 
`📁 𝐅𝐢𝐥𝐞 𝐭𝐨 𝐋𝐢𝐧𝐤 𝐒𝐞𝐫𝐯𝐢𝐜𝐞
━━━━━━━━━━━━━━━━━━━━━━
📥 যেকোনো FILE,  APK,  PDF,  VIDEO
📦 সর্বোচ্চ ৫০০ MB পর্যন্ত পাঠান।

⚡ 𝐈𝐧𝐬𝐭𝐚𝐧𝐭 𝐃𝐢𝐫𝐞𝐜𝐭 𝐋𝐢𝐧𝐤
🔗 সাথে সাথেই ১-ক্লিক ডাউনলোড লিংক পাবেন।

 🏠 𝐌𝐚𝐢𝐧 𝐌𝐞𝐧𝐮-তে ফিরতে
'🔙 𝐁𝐚𝐜𝐤 বাটন চাপুন।
━━━━━━━━━━━━━━━━━━━━━━`;

const TIKTOK_SERVICE_TEXT = 
`🎬 𝐓𝐢𝐤𝐓𝐨𝐤 𝐕𝐢𝐝𝐞𝐨 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝𝐞𝐫
━━━━━━━━━━━━━━━━━━━━━━
📥 TikTok ভিডিওর 🔗 লিংকটি পাঠান।

✨ 𝐖𝐢𝐭𝐡𝐨𝐮𝐭 𝐖𝐚𝐭𝐞𝐫𝐦𝐚𝐫𝐤
🎥 𝐇𝐢𝐠𝐡-𝐐𝐮𝐚𝐥𝐢𝐭𝐲 𝐕𝐢𝐝𝐞𝐨

 🏠 𝐌𝐚𝐢𝐧 𝐌𝐞𝐧𝐮-তে ফিরতে
'🔙 𝐁𝐚𝐜𝐤 বাটন চাপুন।
━━━━━━━━━━━━━━━━━━━━━━`;

const FACEBOOK_SERVICE_TEXT = 
`📘 𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝
━━━━━━━━━━━━━━━━━━━━━━
📥 Facebook ভিডিওর 🔗 লিংকটি পাঠান।

✨ পাবলিক ভিডিও সাপোর্ট
🎥 বেস্ট অ্যাভেইলেবল কোয়ালিটি

 🏠 𝐌𝐚𝐢𝐧 𝐌𝐞𝐧𝐮-তে ফিরতে
'🔙 𝐁𝐚𝐜𝐤 বাটন চাপুন।
━━━━━━━━━━━━━━━━━━━━━━`;

function startAutoBackTimer(chatId, userId) {
  if (userTimeouts.has(String(userId))) {
    clearTimeout(userTimeouts.get(String(userId)));
  }
  const timer = setTimeout(async () => {
    try {
      const currentMode = userModes.get(String(userId));
      if (currentMode === 'file' || currentMode === 'tiktok' || currentMode === 'facebook') {
        userModes.set(String(userId), 'main');
        userTimeouts.delete(String(userId));
        await sendMainMenu(chatId, MAIN_MENU_TEXT);
      }
    } catch (err) {
      console.error('Auto back error:', err);
    }
  }, TWO_HOURS);
  userTimeouts.set(String(userId), timer);
}

function cancelAutoBackTimer(userId) {
  if (userTimeouts.has(String(userId))) {
    clearTimeout(userTimeouts.get(String(userId)));
    userTimeouts.delete(String(userId));
  }
}

async function sendMainMenu(chatId, text) {
  try {
    const cleanId = String(chatId).replace(/[^0-9-]/g, '');
    await sendFastTelegramRequest('sendMessage', {
      chat_id: cleanId,
      text: text,
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [
            { text: "𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤", style: "success" },
            { text: "𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨", style: "primary" }
          ],
          [
            { text: "𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝", style: "primary" },
            { text: "𝐒𝐮𝐩𝐩𝐨𝐫𝐭", style: "danger" }
          ]
        ],
        resize_keyboard: true
      }
    });
  } catch (err) {
    console.error('sendMainMenu error:', err);
  }
}

async function sendBackMenu(chatId, text) {
  try {
    const cleanId = String(chatId).replace(/[^0-9-]/g, '');
    await sendFastTelegramRequest('sendMessage', {
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
    });
  } catch (err) {
    console.error('sendBackMenu error:', err);
  }
}

client.addEventHandler(async (update) => {
  if (update.className === 'UpdateBotCallbackQuery') {
    const data = update.data ? update.data.toString() : '';

    if (data === 'check_sub') {
      const senderId = update.userId;
      const joined = await isUserJoined(client, senderId);

      if (joined) {
        subCache.set(String(senderId), { joined: true, time: Date.now() });

        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '✅ ভেরিফিকেশন সফল হয়েছে!',
            alert: false,
          })
        );

        const cleanUserId = String(senderId).replace(/[^0-9-]/g, '');
        await sendFastTelegramRequest('deleteMessage', {
          chat_id: cleanUserId,
          message_id: update.msgId
        });

        userModes.set(String(senderId), 'main');
        cancelAutoBackTimer(senderId);
        await sendMainMenu(senderId, MAIN_MENU_TEXT);

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

client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message) return;
  const senderId = message.senderId;
  const chatId = message.chatId;

  const joined = await checkSubWithSpeed(senderId);
  if (!joined) {
    await sendJoinPrompt(client, chatId);
    return;
  }

  const currentMode = userModes.get(String(senderId)) || 'main';

  const hasRealFile = message.media && (message.media.document || message.media.photo);
  if (hasRealFile) {
    if (currentMode === 'tiktok' || currentMode === 'facebook') {
      await message.reply({ message: '⚠️ আপনি অন্য মোডে আছেন! ফাইল আপলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤" সিলেক্ট করুন।' });
      return;
    }
    if (currentMode === 'main') {
      await message.reply({ message: '⚠️ ফাইল আপলোড করতে প্রথমে নিচের মেনু থেকে "𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤" বাটনটি বেছে নিন।' });
      return;
    }

    startAutoBackTimer(chatId, senderId);
    await processFileUpload(client, message);
    return;
  }

  const text = (message.text || '').trim();

  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
    return;
  }

  if (text === '𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤' || text === 'File To Link' || text === '/file') {
    userModes.set(String(senderId), 'file');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, FILE_SERVICE_TEXT);
    return;
  }

  if (text === '𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨' || text === 'Tiktok Video' || text === '/tiktok') {
    userModes.set(String(senderId), 'tiktok');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, TIKTOK_SERVICE_TEXT);
    return;
  }

  if (text === '𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝' || text === 'Facebook Download' || text === '𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨' || text === '/facebook' || text === '/fb') {
    userModes.set(String(senderId), 'facebook');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, FACEBOOK_SERVICE_TEXT);
    return;
  }

  if (text === '𝐒𝐮𝐩𝐩𝐨𝐫𝐭' || text === 'Support' || text.toLowerCase().includes('support')) {
    const cleanId = String(chatId).replace(/[^0-9-]/g, '');
    const prefillText = encodeURIComponent('আসসালামু আলাইকুম ভাইয়া!');
    const supportUrl = `https://t.me/cx_rakib?text=${prefillText}`;

    await sendFastTelegramRequest('sendMessage', {
      chat_id: cleanId,
      text: 
`🧑‍💻 <b>অ্যাডমিন সাপোর্ট ও সহায়তা কেন্দ্র</b>
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
যেকোনো সমস্যা, প্রশ্ন বা সহায়তার জন্য সরাসরি অ্যাডমিনের সাথে যোগাযোগ করতে পারেন।

👇 <b>নিচের বাটনে ক্লিক করে!</b> 👇`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💬 অ্যাডমিনকে মেসেজ পাঠান", url: supportUrl }
          ]
        ]
      }
    });
    return;
  }

  if (text.includes('𝐁𝐚𝐜𝐤') || text.includes('Back') || text === '/back') {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
    return;
  }

  const isTikTokLink = /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(text);
  if (isTikTokLink) {
    if (currentMode === 'file' || currentMode === 'facebook') {
      await message.reply({ 
        message: '⚠️ আপনি অন্য মোডে আছেন! টিকটক ভিডিও ডাউনলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" মোড সিলেক্ট করুন।' 
      });
      return;
    }

    if (currentMode === 'main') {
      await message.reply({ 
        message: '⚠️ টিকটক ভিডিও ডাউনলোড করতে প্রথমে নিচের মেনু থেকে "𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" বাটনটি বেছে নিন।' 
      });
      return;
    }

    if (currentMode === 'tiktok') {
      const allUrls = text.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)?tiktok\.com\/[^\s]+/gi) || [];
      const cleanVideoUrl = allUrls.find(u => !u.toLowerCase().includes('tiktoklite')) || allUrls[0];

      if (cleanVideoUrl) {
        startAutoBackTimer(chatId, senderId);
        await handleTikTokDownload(client, chatId, cleanVideoUrl);
        return;
      }
    }
  }

  const isFacebookLink = /(?:facebook\.com|fb\.watch|fb\.com)/i.test(text);
  if (isFacebookLink) {
    if (currentMode === 'file' || currentMode === 'tiktok') {
      await message.reply({ 
        message: '⚠️ আপনি অন্য মোডে আছেন! Facebook ভিডিও ডাউনলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝" মোড সিলেক্ট করুন।' 
      });
      return;
    }

    if (currentMode === 'main') {
      await message.reply({ 
        message: '⚠️ Facebook ভিডিও ডাউনলোড করতে প্রথমে নিচের মেনু থেকে "𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝" বাটনটি বেছে নিন।' 
      });
      return;
    }

    if (currentMode === 'facebook') {
      startAutoBackTimer(chatId, senderId);
      await handleFacebookDownload(client, chatId, text);
      return;
    }
  }

  if (currentMode === 'tiktok') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক টিকটক ভিডিওর লিংক পাঠান (যেমন: https://vt.tiktok.com/...)' });
  } else if (currentMode === 'facebook') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক Facebook ভিডিওর লিংক পাঠান (যেমন: https://www.facebook.com/... বা https://fb.watch/...)' });
  } else if (currentMode === 'file') {
    await message.reply({ message: '⚠️ আপনি "ফাইল টু লিংক" মোডে আছেন! অনুগ্রহ করে যেকোনো ফাইল, ভিডিও, APK বা ডকুমেন্ট সেন্ড করুন।' });
  } else {
    await message.reply({ message: '💡 যেকোনো ফাইল সেন্ড করতে বা ভিডিও ডাউনলোড করতে নিচের মেনু বাটন ব্যবহার করুন।' });
  }
}, new NewMessage({ incoming: true }));

setupDownloadRoute(app, client);
app.get('/', (req, res) => res.send('Multi-Function Bot Server is Live!'));

setInterval(async () => {
  try {
    if (client && client.connected) {
      await client.invoke(new Api.help.GetConfig());
    } else if (client) {
      await client.connect();
    }
  } catch (e) {}
}, 25 * 1000);

setInterval(() => {
  if (BASE_URL) fetch(BASE_URL).catch(() => {});
}, 8 * 60 * 1000);

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  const me = await client.getMe();
  botUsername = me.username;
  console.log(`Bot @${botUsername} started successfully!`);
});
