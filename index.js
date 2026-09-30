require('dotenv').config();
const express = require('express');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage, CallbackQuery } = require('telegram/events');
const { Button } = require('telegram/tl/custom/button');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BIN_CHANNEL = process.env.BIN_CHANNEL; // আপনার প্রাইভেট স্টোরেজ চ্যানেল
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const FORCE_CHANNEL = 'Mrincomeboss'; // আপনার চ্যানেল ইউজারনেম
const FORCE_CHANNEL_URL = 'https://t.me/Mrincomeboss';

if (!API_ID || !API_HASH || !BOT_TOKEN || !BIN_CHANNEL || !BASE_URL) {
  console.error("Missing Environment Variables!");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
  connectionRetries: 5,
});

const app = express();

// ব্যবহারকারী চ্যানেলে জয়েন আছে কিনা তা যাচাই করার ফাংশন
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

// জয়েন না থাকলে যে মেসেজ ও বাটন পাঠানো হবে
async function sendJoinPrompt(chatId) {
  const text = 
`⚠️ **প্রবেশাধিকার সীমিত!**

বটটি ব্যবহার করতে হলে আপনাকে অবশ্যই আমাদের অফিশিয়াল চ্যানেলে যুক্ত হতে হবে। নিচের বাটনে ক্লিক করে চ্যানেলে জয়েন করুন, তারপর **'🔄 জয়েন করেছি (Verify)'** বাটনে চাপ দিন।`;

  const buttons = [
    [Button.url('📢 Join Our Channel', FORCE_CHANNEL_URL)],
    [Button.inline('🔄 জয়েন করেছি (Verify)', Buffer.from('check_sub'))]
  ];

  await client.sendMessage(chatId, {
    message: text,
    buttons: buttons,
    parseMode: 'md',
  });
}

// ১. টেক্সট ও /start কমান্ড হ্যান্ডলার
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message || message.media) return; // ফাইল আসলে অন্য হ্যান্ডলারে যাবে

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

// ২. ইনলাইন বাটন ক্লিক (Verify Button) হ্যান্ডলার
client.addEventHandler(async (event) => {
  const data = event.data?.toString();

  if (data === 'check_sub') {
    const senderId = event.senderId;
    const joined = await isUserJoined(senderId);

    if (joined) {
      await event.answer({ message: '✅ ভেরিফিকেশন সফল হয়েছে!', alert: false });
      await event.edit({
        message: 
`🎉 **ধন্যবাদ! আপনি সফলভাবে চ্যানেলে যুক্ত হয়েছেন।**

⚡ **File to Link সক্রিয় হয়েছে!**
এখন আপনি যেকোনো ফাইল, পিডিএফ, অডিও, ভিডিও বা ছবি পাঠান—সরাসরি ডাউনলোড লিংক পেয়ে যাবেন।`,
        parseMode: 'md',
      });
    } else {
      await event.answer({ 
        message: '❌ আপনি এখনো চ্যানেলে জয়েন করেননি! দয়া করে আগে চ্যানেলে জয়েন করুন।', 
        alert: true 
      });
    }
  }
}, new CallbackQuery());

// ৩. ফাইল, ভিডিও, ছবি আসলে হ্যান্ডল করার ইঞ্জিন
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message || !message.media) return;

  const senderId = message.senderId;
  const joined = await isUserJoined(senderId);

  // চ্যানেলে জয়েন না থাকলে ফাইল প্রসেস করবে না
  if (!joined) {
    await sendJoinPrompt(message.chatId);
    return;
  }

  try {
    // স্টোরেজ চ্যানেলে ফাইল পাঠানো
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

// ৪. ব্রাউজারে ডাউনলোড দেওয়ার রাউট
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

// সার্ভার যেন ঘুমিয়ে না পড়ে তার জন্য সেলফ-পিং
setInterval(() => {
  if (BASE_URL) {
    fetch(BASE_URL).catch(() => {});
  }
}, 8 * 60 * 1000); // প্রতি ৮ মিনিট পর পর পিং করবে

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await client.start({ botAuthToken: BOT_TOKEN });
  console.log('বট সফলভাবে কানেক্ট হয়েছে!');
});
