require('dotenv').config();
const express = require('express');
const https = require('https');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const { isUserJoined, sendJoinPrompt } = require('./forceSub');
const { processFileUpload, setupDownloadRoute } = require('./fileHandler');
const { handleTikTokDownload } = require('./tiktokHandler');
const { handleFacebookDownload } = require('./facebookHandler');
const { handlePlayStoreDownload } = require('./playstoreHandler');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { 
  connectionRetries: Infinity,
  autoReconnect: true,
  useWSS: false,
  timeout: 30000
});

const app = express();
let botUsername = '';
const userModes = new Map();
const userTimeouts = new Map();
const TWO_HOURS = 2 * 60 * 60 * 1000;

const httpAgent = new https.Agent({ 
  keepAlive: true, 
  keepAliveMsecs: 60000, 
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
      agent: httpAgent,
      timeout: 5000
    }, (res) => {
      res.resume();
      resolve(true);
    });

    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  });
}

// ⚡ সুপারফাস্ট ৫-মিনিটের মেম্বারশিপ ক্যাশ (বাটন হবে ০.০০১ সেকেন্ড দ্রুত)
const subCache = new Map();
const SUB_CACHE_TTL = 5 * 60 * 1000;

async function checkSubWithSpeed(userId) {
  if (!userId) return false;
  const userKey = String(userId);
  const cached = subCache.get(userKey);

  if (cached && (Date.now() - cached.time < SUB_CACHE_TTL)) {
    return cached.joined;
  }

  try {
    const joined = await isUserJoined(client, userId);
    const isValid = Boolean(joined);
    subCache.set(userKey, { joined: isValid, time: Date.now() });
    return isValid;
  } catch (err) {
    subCache.set(userKey, { joined: false, time: Date.now() });
    return false;
  }
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
`📘 𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨
━━━━━━━━━━━━━━━━━━━━━━
📥 Facebook ভিডিওর 🔗 লিংকটি পাঠান।

✨ পাবলিক ভিডিও সাপোর্ট
🎥 বেস্ট অ্যাভেইলেবল কোয়ালিটি

 🏠 𝐌𝐚𝐢𝐧 𝐌𝐞𝐧𝐮-তে ফিরতে
'🔙 𝐁𝐚𝐜𝐤 বাটন চাপুন।
━━━━━━━━━━━━━━━━━━━━━━`;

const PLAYSTORE_SERVICE_TEXT = 
`📲 𝐏𝐥𝐚𝐲 𝐒𝐭𝐨𝐫𝐞 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝𝐞𝐫
━━━━━━━━━━━━━━━━━━━━━━
📥 Play Store অ্যাপের নাম (বাংলা/ইংরেজি) বা লিংক পাঠান।

⚡ 𝐋𝐚𝐭𝐞𝐬𝐭 𝐔𝐩𝐝𝐚𝐭𝐞 𝐀𝐏𝐊
📦 সরাসরি ১-ক্লিক ইনস্টলেবল লেটেস্ট ভার্সন।

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
      if (currentMode === 'file' || currentMode === 'tiktok' || currentMode === 'facebook' || currentMode === 'playstore') {
        userModes.set(String(userId), 'main');
        userTimeouts.delete(String(userId));
        await sendMainMenu(chatId, MAIN_MENU_TEXT);
      }
    } catch (err) {}
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
            { text: "𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨", style: "primary" },
            { text: "📲 𝐏𝐥𝐚𝐲 𝐒𝐭𝐨𝐫𝐞", style: "success" }
          ],
          [
            { text: "𝐒𝐮𝐩𝐩𝐨𝐫𝐭", style: "danger" }
          ]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      }
    });
  } catch (err) {}
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
        resize_keyboard: true,
        one_time_keyboard: false
      }
    });
  } catch (err) {}
}

async function hideKeyboardAndLock(chatId) {
  try {
    const cleanId = String(chatId).replace(/[^0-9-]/g, '');
    await sendFastTelegramRequest('sendMessage', {
      chat_id: cleanId,
      text: '🔒 **বটের সকল ফিচার ব্যবহার করতে চ্যানেলে জয়েন করা বাধ্যতামূলক!**',
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true }
    });
  } catch (e) {}
}

client.addEventHandler(async (update) => {
  if (update.className === 'UpdateBotCallbackQuery') {
    const data = update.data ? update.data.toString() : '';

    if (data === 'check_sub') {
      const senderId = update.userId;
      subCache.delete(String(senderId));
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
        subCache.set(String(senderId), { joined: false, time: Date.now() });
        await client.invoke(
          new Api.messages.SetBotCallbackAnswer({
            queryId: update.queryId,
            message: '⚠️ আপনি এখনো চ্যানেলে জয়েন করেননি!',
            alert: true,
          })
        );
      }
    }
  }
});

// মেসেজ ইভেন্ট হ্যান্ডলার
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message) return;
  const senderId = message.senderId;
  const chatId = message.chatId;

  if (!senderId) return;

  const text = (message.text || '').trim();

  // ⚡ কমান্ড ও বাটন সবার আগে ইনস্ট্যান্ট রেসপন্স করবে
  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
    return;
  }

  if (text.includes('Back') || text.includes('𝐁𝐚𝐜𝐤') || text === '/back') {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
    return;
  }

  const joined = await checkSubWithSpeed(senderId);
  if (!joined) {
    userModes.delete(String(senderId));
    cancelAutoBackTimer(senderId);
    await hideKeyboardAndLock(chatId);
    await sendJoinPrompt(client, chatId);
    return;
  }

  const currentMode = userModes.get(String(senderId)) || 'main';

  // ফাইল হ্যান্ডলার
  const hasRealFile = message.media && (message.media.document || message.media.photo);
  if (hasRealFile) {
    if (currentMode === 'tiktok' || currentMode === 'facebook' || currentMode === 'playstore') {
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

  if (text.includes('File To Link') || text.includes('𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤') || text === '/file') {
    userModes.set(String(senderId), 'file');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, FILE_SERVICE_TEXT);
    return;
  }

  if (text.includes('Tiktok Video') || text.includes('𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨') || text === '/tiktok') {
    userModes.set(String(senderId), 'tiktok');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, TIKTOK_SERVICE_TEXT);
    return;
  }

  if (text.includes('Facebook Video') || text.includes('𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨') || text.includes('Facebook Download') || text.includes('𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝') || text === '/facebook' || text === '/fb') {
    userModes.set(String(senderId), 'facebook');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, FACEBOOK_SERVICE_TEXT);
    return;
  }

  if (text.includes('Play Store') || text.includes('𝐏𝐥𝐚𝐲 𝐒𝐭𝐨𝐫𝐞') || text === '/playstore' || text === '/apk') {
    userModes.set(String(senderId), 'playstore');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, PLAYSTORE_SERVICE_TEXT);
    return;
  }

  if (text.includes('Support') || text.includes('𝐒𝐮𝐩𝐩𝐨𝐫𝐭')) {
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

  // প্লে স্টোর ডাউনলোড
  const isPlayStoreLink = /(?:play\.google\.com\/store\/apps\/details)/i.test(text);
  if (isPlayStoreLink || currentMode === 'playstore') {
    if (isPlayStoreLink && currentMode !== 'playstore' && currentMode !== 'main') {
      await message.reply({ message: '⚠️ আপনি অন্য মোডে আছেন! অ্যাপ ডাউনলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "📲 𝐏𝐥𝐚𝐲 𝐒𝐭𝐨𝐫𝐞" মোড সিলেক্ট করুন।' });
      return;
    }
    startAutoBackTimer(chatId, senderId);
    await handlePlayStoreDownload(client, chatId, text);
    return;
  }

  // টিকটক প্রসেসিং
  const isTikTokLink = /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(text);
  if (isTikTokLink) {
    if (currentMode === 'file' || currentMode === 'facebook' || currentMode === 'playstore') {
      await message.reply({ message: '⚠️ আপনি অন্য মোডে আছেন! টিকটক ভিডিও ডাউনলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" মোড সিলেক্ট করুন।' });
      return;
    }
    if (currentMode === 'main') {
      await message.reply({ message: '⚠️ টিকটক ভিডিও ডাউনলোড করতে প্রথমে নিচের মেনু থেকে "𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" বাটনটি বেছে নিন।' });
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

  // ফেসবুক প্রসেসিং
  const isFacebookLink = /(?:facebook\.com|fb\.watch|fb\.com)/i.test(text);
  if (isFacebookLink) {
    if (currentMode === 'file' || currentMode === 'tiktok' || currentMode === 'playstore') {
      await message.reply({ message: '⚠️ আপনি অন্য মোডে আছেন! Facebook ভিডিও ডাউনলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" মোড সিলেক্ট করুন।' });
      return;
    }
    if (currentMode === 'main') {
      await message.reply({ message: '⚠️ Facebook ভিডিও ডাউনলোড করতে প্রথমে নিচের মেনু থেকে "𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" বাটনটি বেছে নিন।' });
      return;
    }
    if (currentMode === 'facebook') {
      startAutoBackTimer(chatId, senderId);
      await handleFacebookDownload(client, chatId, text);
      return;
    }
  }

  if (currentMode === 'tiktok') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক টিকটক ভিডিওর লিংক পাঠান।' });
  } else if (currentMode === 'facebook') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে একটি সঠিক Facebook ভিডিওর লিংক পাঠান।' });
  } else if (currentMode === 'playstore') {
    await message.reply({ message: '⚠️ অনুগ্রহ করে অ্যাপের নাম (বাংলা/ইংরেজি) অথবা প্লে স্টোর লিংক পাঠান।' });
  } else if (currentMode === 'file') {
    await message.reply({ message: '⚠️ আপনি "ফাইল টু লিংক" মোডে আছেন! অনুগ্রহ করে যেকোনো ফাইল, ভিডিও, APK বা ডকুমেন্ট সেন্ড করুন।' });
  } else {
    await message.reply({ message: '💡 যেকোনো ফাইল সেন্ড করতে বা ভিডিও ডাউনলোড করতে নিচের মেনু বাটন ব্যবহার করুন।' });
  }
}, new NewMessage({ incoming: true }));

setupDownloadRoute(app, client);

app.get('/', (req, res) => res.send('Multi-Function Bot Server is Live 24/7!'));
app.get('/ping', (req, res) => res.status(200).send('PONG_ALIVE'));

// 🚀 টেলিগ্রাম সক্রিয় কানেকশন গার্ড
setInterval(async () => {
  try {
    if (!client.connected) {
      await client.connect();
    }
  } catch (e) {}
}, 5000);

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  const me = await client.getMe();
  botUsername = me.username;
  console.log(`Bot @${botUsername} started successfully!`);
});
