require('dotenv').config();
const express = require('express');
const https = require('https');
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

// আল্ট্রা ফাস্ট কানেকশন এবং অটো-রিকানেক্ট সেটিংস
const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { 
  connectionRetries: 10,
  autoReconnect: true,
  useWSS: false
});

const app = express();
let botUsername = '';
const userModes = new Map();
const userTimeouts = new Map();
const TWO_HOURS = 2 * 60 * 60 * 1000; // ২ ঘণ্টা (মিলিসেকেন্ডে)

// অতি দ্রুত বাটন ও মেসেজ পাঠানোর জন্য পার্মানেন্ট হাই-স্পিড সকেট
const httpAgent = new https.Agent({ 
  keepAlive: true, 
  keepAliveMsecs: 30000, 
  maxSockets: 50,
  maxFreeSockets: 20
});

// লাইটনিং ফাস্ট টেলিগ্রাম রিকোয়েস্ট সেন্ডার
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
      res.resume(); // সকেট মুক্ত করে পরবর্তী ক্লিকের জন্য প্রস্তুত রাখা
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  });
}

// চেকিং অপরিবর্তিত রেখে বাটন ক্লিকে ইনস্ট্যান্ট রেসপন্স দেওয়ার জন্য ৫ মিনিটের মেমরি ক্যাশ
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

// ২ ঘণ্টার অটো-ব্যাক টাইমার
function startAutoBackTimer(chatId, userId) {
  if (userTimeouts.has(String(userId))) {
    clearTimeout(userTimeouts.get(String(userId)));
  }
  const timer = setTimeout(async () => {
    try {
      const currentMode = userModes.get(String(userId));
      if (currentMode === 'file' || currentMode === 'tiktok') {
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

// প্রধান মেনুর কিবোর্ড (আল্ট্রা ফাস্ট)
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

// সাব-মেনু কিবোর্ড ও ব্যাক কিবোর্ড (আল্ট্রা ফাস্ট)
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

// ১. ইনলাইন ভেরিফিকেশন
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

        try {
          await client.deleteMessages(update.peer, [update.msgId], { revoke: true });
        } catch (e) {}

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

// ২. মূল মেসেজ হ্যান্ডলার (জিরো ল্যাগ ও আল্ট্রা ফাস্ট)
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message) return;
  const senderId = message.senderId;
  const chatId = message.chatId;

  // চ্যানেল ভেরিফিকেশন (চেকিং অক্ষুণ্ণ রেখে আল্ট্রা স্পিডে সম্পন্ন হবে)
  const joined = await checkSubWithSpeed(senderId);
  if (!joined) {
    await sendJoinPrompt(client, chatId);
    return;
  }

  // ★ ১ নম্বর অগ্রাধিকার: মেসেজের সাথে ফাইল/ডকুমেন্ট থাকলে সেটি হ্যান্ডল হবে
  const hasRealFile = message.media && (message.media.document || message.media.photo);
  if (hasRealFile) {
    const currentMode = userModes.get(String(senderId)) || 'file';
    if (currentMode === 'tiktok') {
      await message.reply({ message: '⚠️ আপনি টিকটক মোডে আছেন! ফাইল আপলোড করতে নিচে "🔙 𝐁𝐚𝐜𝐤" বাটনে চাপ দিয়ে "𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤" সিলেক্ট করুন।' });
      return;
    }

    startAutoBackTimer(chatId, senderId);
    await processFileUpload(client, message);
    return;
  }

  // ★ ২ নম্বর অগ্রাধিকার: সাধারণ টেক্সট বা বাটন ক্লিক
  const text = (message.text || '').trim();

  // /start কমান্ড দিলে
  if (text.startsWith('/start')) {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
    return;
  }

  // বাটন ১: 𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤
  if (text === '𝐅𝐢𝐥𝐞 𝐓𝐨 𝐋𝐢𝐧𝐤' || text === 'File To Link' || text === '/file') {
    userModes.set(String(senderId), 'file');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, FILE_SERVICE_TEXT);
    return;
  }

  // বাটন ২: 𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨
  if (text === '𝐓𝐢𝐤𝐭𝐨𝐤 𝐕𝐢𝐝𝐞𝐨' || text === 'Tiktok Video' || text === '/tiktok') {
    userModes.set(String(senderId), 'tiktok');
    startAutoBackTimer(chatId, senderId);
    await sendBackMenu(chatId, TIKTOK_SERVICE_TEXT);
    return;
  }

  // বাটন ৩: 𝐒𝐮𝐩𝐩𝐨𝐫𝐭 (সিনট্যাক্স ঠিক করা হয়েছে)
  if (text === '𝐒𝐮𝐩𝐩𝐨𝐫𝐭' || text === 'Support') {
    const prefillText = encodeURIComponent('আসসালামু আলাইকুম ভাইয়া!');
    const supportUrl = `https://t.me/cx_rakib?text=${prefillText}`;

    await client.sendMessage(chatId, {
      message:
`👨‍💻 **অ্যাডমিন সাপোর্ট ও সহায়তা কেন্দ্র**
━━━━━━━━━━━━━━━━━━━━━━
যেকোনো সমস্যা, প্রশ্ন বা সহায়তার জন্য সরাসরি অ্যাডমিনের সাথে যোগাযোগ করতে পারেন।

👇 **নিচের বাটনে ক্লিক করুন 👇 **`,
      buttons: [
        [Button.url('💬 অ্যাডমিনকে মেসেজ পাঠান', supportUrl)]
      ],
      parseMode: 'md',
    });
    return;
  }

  // বাটন ৪: '🔙 𝐁𝐚𝐜𝐤' (সুপার ফাস্ট হ্যান্ডলিং)
  if (text.includes('𝐁𝐚𝐜𝐤') || text.includes('Back') || text === '/back') {
    userModes.set(String(senderId), 'main');
    cancelAutoBackTimer(senderId);
    await sendMainMenu(chatId, MAIN_MENU_TEXT);
    return;
  }

  // টিকটক লিংক আসলে সরাসরি ডাউনলোড
  const isTikTokLink = /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(text);
  if (isTikTokLink) {
    startAutoBackTimer(chatId, senderId);
    await handleTikTokDownload(client, chatId, text);
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

// ৫-২০ দিন বা ১ মাস পরেও যেন সকেট ফ্রেশ থাকে (MTProto 24/7 Keep-Alive)
setInterval(async () => {
  try {
    if (client && client.connected) {
      await client.invoke(new Api.help.GetConfig()); // সংযোগ সর্বদা লাইভ রাখবে
    } else if (client) {
      await client.connect();
    }
  } catch (e) {}
}, 25 * 1000);

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
