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

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { 
  connectionRetries: 20,
  autoReconnect: true,
  useWSS: false
});

const app = express();
let botUsername = '';
const userModes = new Map();
const userTimeouts = new Map();
const TWO_HOURS = 2 * 60 * 60 * 1000;

// হাই-স্পিড কিপ-অ্যালাইভ এজেন্ট
const httpAgent = new https.Agent({ 
  keepAlive: true, 
  keepAliveMsecs: 60000, 
  maxSockets: 100,
  maxFreeSockets: 30
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

// ⚡ রিয়েল-টাইম মেম্বারশিপ ক্যাশ (১০ সেকেন্ড - হ্যাং হবে না)
const subCache = new Map();
const SUB_CACHE_TTL = 10 * 1000;

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

// 🎨 আপনার চাহিদা অনুযায়ী কালার ও লোগোসহ মেইন মেনু বাটন
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
            { text: "📁 𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤", style: "primary" },   // রয়্যাল ব্লু + লোগো
            { text: "🎵 𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨", style: "success" }   // গ্রিন + টিকটক লোগো
          ],
          [
            { text: "📘 𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨", style: "primary" }, // ব্লু + ফেসবুক লোগো
            { text: "💬 𝐒𝐮𝐩𝐩𝐨𝐫𝐭", style: "danger" }          // রেড + সাপোর্ট লোগো
          ]
        ],
        resize_keyboard: true,
        is_persistent: true
      }
    });
  } catch (err) {}
}

// 🎨 ব্যাক বাটন (রেড স্টাইল)
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
        is_persistent: true
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
            message: '⚠️ আপনি এখনো চ্যানেলে জয়েন করেননি! দয়া করে আগে চ্যানেলে জয়েন করে আবার চাপুন।',
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

  if (!senderId) return;

  const joined = await checkSubWithSpeed(senderId);
  if (!joined) {
    userModes.delete(String(senderId));
    cancelAutoBackTimer(senderId);
    await hideKeyboardAndLock(chatId);
    await sendJoinPrompt(client, chatId);
    return;
  }

  const currentMode = userModes.get(String(senderId)) || 'main';

  const hasRealFile = message.media && (message.media.document || message.media.photo);
  if (hasRealFile) {
    if (currentMode === 'tiktok' || currentMode === 'facebook') {
      await message.reply({ message: '⚠️ আপনি অন্য মোডে আছেন! ফাইল আপলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "📁 𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤" সিলেক্ট করুন।' });
      return;
    }
    if (currentMode === 'main') {
      await message.reply({ message: '⚠️ ফাইল আপলোড করতে প্রথমে নিচের মেনু থেকে "📁 𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤" বাটনটি বেছে নিন।' });
      return;
    }

    startAutoBackTimer(chatId, senderId);
    await processFileUpload(client, message);
    return;
  }

  const text = (message.text || '').trim();

  // ⚡ ইনস্ট্যান্ট মেনু নেভিগেশন (০.০৫ সেকেন্ড স্পিড)
  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
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

  if (text.includes('Back') || text.includes('𝐁𝐚𝐜𝐤') || text === '/back') {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
    return;
  }

  // টিকটক হ্যান্ডলার
  const isTikTokLink = /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(text);
  if (isTikTokLink) {
    if (currentMode === 'file' || currentMode === 'facebook') {
      await message.reply({ message: '⚠️ আপনি অন্য মোডে আছেন! টিকটক ভিডিও ডাউনলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "🎵 𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" মোড সিলেক্ট করুন।' });
      return;
    }
    if (currentMode === 'main') {
      await message.reply({ message: '⚠️ টিকটক ভিডিও ডাউনলোড করতে প্রথমে নিচের মেনু থেকে "🎵 𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" বাটনটি বেছে নিন।' });
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

  // ফেসবুক হ্যান্ডলার
  const isFacebookLink = /(?:facebook\.com|fb\.watch|fb\.com)/i.test(text);
  if (isFacebookLink) {
    if (currentMode === 'file' || currentMode === 'tiktok') {
      await message.reply({ message: '⚠️ আপনি অন্য মোডে আছেন! Facebook ভিডিও ডাউনলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "📘 𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" মোড সিলেক্ট করুন।' });
      return;
    }
    if (currentMode === 'main') {
      await message.reply({ message: '⚠️ Facebook ভিডিও ডাউনলোড করতে প্রথমে নিচের মেনু থেকে "📘 𝐅𝐚𝐜𝐞𝐛𝐨𝐨𝐤 𝐕𝐢𝐝𝐞𝐨" বাটনটি বেছে নিন।' });
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

// 🛡️ ২৪/৭ অ্যান্টি-স্লিপ পিং রাউট
app.get('/', (req, res) => res.send('Multi-Function Bot Server is Live 24/7!'));
app.get('/ping', (req, res) => res.status(200).send('PONG_ALIVE'));

// 🚀 টেলিগ্রাম সংযোগ যেন ১ বছরেও না কাটে (Keep-Alive Heartbeat)
setInterval(async () => {
  try {
    if (client && client.connected) {
      await client.invoke(new Api.help.GetConfig());
    } else if (client && !client.connected) {
      await client.connect();
    }
  } catch (e) {}
}, 20 * 1000); // প্রতি ২০ সেকেন্ডে হার্টবিট

// 🚀 সার্ভার যেন কখনো না ঘুমায় (Self-Wake Up Engine)
setInterval(() => {
  if (BASE_URL) {
    fetch(`${BASE_URL}/ping`).catch(() => {});
  }
}, 3 * 60 * 1000); // প্রতি ৩ মিনিটে সেলফ-পিং

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  const me = await client.getMe();
  botUsername = me.username;
  console.log(`Bot @${botUsername} started successfully!`);
});
