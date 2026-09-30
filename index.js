require('dotenv').config();
const express = require('express');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Button } = require('telegram/tl/custom/button');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BIN_CHANNEL = process.env.BIN_CHANNEL;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const FORCE_CHANNEL = 'Mrincomeboss';
const FORCE_CHANNEL_URL = 'https://t.me/Mrincomeboss';

if (!API_ID || !API_HASH || !BOT_TOKEN || !BIN_CHANNEL || !BASE_URL) {
  console.error("Missing Environment Variables!");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
  connectionRetries: 5,
});

const app = express();
let botUsername = '';

// ব্যবহারকারী চ্যানেলে জয়েন আছে কিনা যাচাই করার ফাংশন
async function isUserJoined(userId) {
  try {
    const res = await client.invoke(
      new Api.channels.GetParticipant({
        channel: FORCE_CHANNEL,
        participant: userId,
      })
    );
    return !!res;
  } catch (err) {
    return false;
  }
}

// চ্যানেলে জয়েন না থাকলে সুন্দর বাটন সহ মেসেজ পাঠানো
async function sendJoinPrompt(chatId) {
  const verifyUrl = botUsername 
    ? `https://t.me/${botUsername}?start=verify`
    : FORCE_CHANNEL_URL;

  const text = 
`⚠️ **প্রবেশাধিকার সীমিত!**

বটটি ব্যবহার করতে হলে আপনাকে অবশ্যই আমাদের অফিশিয়াল চ্যানেলে যুক্ত হতে হবে। নিচের **'📢 Join Our Channel'** বাটনে ক্লিক করে জয়েন করুন, তারপর **'🔄 ভেরিফাই করুন'** বাটনে চাপ দিন।`;

  const buttons = [
    [Button.url('📢 Join Our Channel', FORCE_CHANNEL_URL)],
    [Button.url('🔄 ভেরিফাই করুন (Check)', verifyUrl)]
  ];

  await client.sendMessage(chatId, {
    message: text,
    buttons: buttons,
    parseMode: 'md',
  });
}

// ১. /start এবং টেক্সট মেসেজ হ্যান্ডলার
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message || message.media) return;

  const text = message.text || '';
  const senderId = message.senderId;

  if (text.startsWith('/start')) {
    const joined = await isUserJoined(senderId);

    if (!joined) {
      await sendJoinPrompt(message.chatId);
      return;
    }

    await message.reply({
      message: 
`🎉 **স্বাগতম! চ্যানেল ভেরিফিকেশন সফল হয়েছে।**

⚡ **File to Link সার্ভিস এখন সম্পূর্ণ সক্রিয়!**
আমাকে যেকোনো **ফাইল, পিডিএফ, ভিডিও বা ছবি (সর্বোচ্চ ১০০ এমবি)** পাঠান। আমি সাথে সাথে সেটির সরাসরি ১-ক্লিক ডাউনলোড লিংক তৈরি করে দেব।`,
      parseMode: 'md',
    });
  }
}, new NewMessage({ incoming: true }));

// ২. ফাইল, ভিডিও, ছবি আসলে হ্যান্ডল করার ইঞ্জিন
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message || !message.media) return;

  const senderId = message.senderId;
  const joined = await isUserJoined(senderId);

  // চ্যানেলে জয়েন না থাকলে ফাইল তৈরি হবে না
  if (!joined) {
    await sendJoinPrompt(message.chatId);
    return;
  }

  try {
    const sentMsg = await client.sendFile(BIN_CHANNEL, {
      file: message.media,
      caption: message.text || '',
    });

    const channelMsgId = sentMsg.id;
    let fileName = 'file.bin';
    let fileSize = 0;
    let fileType = 'ফাইল';

    if (message.media.document) {
      const doc = message.media.document;
      fileSize = Number(doc.size);
      const attr = doc.attributes?.find((a) => a.className === 'DocumentAttributeFilename');
      if (attr) {
        fileName = attr.fileName;
      } else {
        fileName = doc.mimeType === 'application/pdf' ? 'document.pdf' : 'video.mp4';
      }
      fileType = fileName.endsWith('.pdf') ? 'পিডিএফ (PDF)' : (fileName.endsWith('.mp4') ? 'ভিডিও (Video)' : 'ডকুমেন্ট');
    } else if (message.media.photo) {
      fileName = `photo_${Date.now()}.jpg`;
      fileType = 'ছবি (Photo)';
    }

    const downloadLink = `${BASE_URL}/dl/${channelMsgId}/${encodeURIComponent(fileName)}`;
    const sizeMB = fileSize ? (fileSize / (1024 * 1024)).toFixed(2) : '0';

    await message.reply({
      message: `✅ **${fileType} সফলভাবে আপলোড হয়েছে!**\n\n` +
        `📄 **নাম:** ${fileName}\n` +
        (fileSize ? `📦 **সাইজ:** ${sizeMB} MB\n\n` : `\n`) +
        `📥 **সরাসরি ডাউনলোড লিংক (One-Click):**\n${downloadLink}\n\n` +
        `💡 *লিংকে ক্লিক করলেই ব্রাউজারে ফাইলটি সরাসরি নামা শুরু হবে।*`,
      parseMode: 'md',
    });
  } catch (err) {
    console.error('Upload error:', err);
    await message.reply({ message: '❌ ফাইল প্রসেস করতে ব্যর্থ হয়েছে। চ্যানেলে বট অ্যাডমিন আছে কিনা চেক করুন।' });
  }
}, new NewMessage({ incoming: true }));

// ৩. ব্রাউজারে ১-ক্লিক ডাউনলোড ইঞ্জিন
app.get('/dl/:id/:filename', async (req, res) => {
  try {
    const msgId = Number(req.params.id);
    if (!msgId || isNaN(msgId)) return res.status(400).send('ভুল লিংক আইডি!');

    const messages = await client.getMessages(BIN_CHANNEL, { ids: [msgId] });
    if (!messages || messages.length === 0 || !messages[0]?.media) {
      return res.status(404).send('ফাইল পাওয়া যায়নি বা ডিলিট হয়ে গেছে!');
    }

    const media = messages[0].media;
    const doc = media.document;
    let fileName = req.params.filename || 'downloaded_file';
    let fileSize = doc ? Number(doc.size) : 0;
    let mimeType = doc?.mimeType || 'application/octet-stream';

    const range = req.headers.range;
    const disposition = `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

    if (range && fileSize > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Content-Disposition': disposition,
      });

      for await (const chunk of client.iterDownload({
        file: media,
        offset: BigInt(start),
        limit: chunksize,
        chunkSize: 512 * 1024,
      })) {
        res.write(chunk);
      }
      res.end();
    } else {
      const headers = {
        'Content-Type': mimeType,
        'Content-Disposition': disposition,
        'Accept-Ranges': 'bytes',
      };
      if (fileSize > 0) headers['Content-Length'] = fileSize;

      res.writeHead(200, headers);

      for await (const chunk of client.iterDownload({
        file: media,
        chunkSize: 512 * 1024,
      })) {
        res.write(chunk);
      }
      res.end();
    }
  } catch (err) {
    console.error('Download error:', err);
    if (!res.headersSent) res.status(500).send('ডাউনলোড শুরু করতে সমস্যা হয়েছে।');
  }
});

app.get('/', (req, res) => res.send('File-to-Link Server is Live!'));

// সার্ভার ঘুমিয়ে পড়া ঠেকাতে সেলফ-পিং
setInterval(() => {
  if (BASE_URL) {
    fetch(BASE_URL).catch(() => {});
  }
}, 8 * 60 * 1000);

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  const me = await client.getMe();
  botUsername = me.username;
  console.log(`বট @${botUsername} সফলভাবে টেলিগ্রামে কানেক্ট হয়েছে!`);
});
