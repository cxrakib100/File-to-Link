require('dotenv').config();
const express = require('express');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BIN_CHANNEL = process.env.BIN_CHANNEL;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

if (!API_ID || !API_HASH || !BOT_TOKEN || !BIN_CHANNEL || !BASE_URL) {
  console.error("Missing Environment Variables!");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { connectionRetries: 5 });
const app = express();

client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message || !message.media) return;

  if (message.media.document || message.media.photo) {
    try {
      const forwarded = await client.forwardMessages(BIN_CHANNEL, {
        messages: [message.id],
        fromPeer: message.chatId,
      });

      const channelMsgId = forwarded[0].id;
      let fileName = 'file.pdf';
      let fileSize = 0;

      if (message.media.document) {
        const doc = message.media.document;
        fileSize = Number(doc.size);
        const attr = doc.attributes?.find((a) => a.className === 'DocumentAttributeFilename');
        if (attr) fileName = attr.fileName;
      } else if (message.media.photo) {
        fileName = 'image.jpg';
      }

      const downloadLink = `${BASE_URL}/dl/${channelMsgId}/${encodeURIComponent(fileName)}`;
      const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      await message.reply({
        message: `✅ **পিডিএফ সফলভাবে তৈরি হয়েছে!**\n\n📄 **নাম:** ${fileName}\n📦 **সাইজ:** ${sizeMB} MB\n\n📥 **১-ক্লিক সরাসরি ডাউনলোড লিংক:**\n${downloadLink}`,
        parseMode: 'md',
      });
    } catch (err) {
      console.error(err);
      await message.reply({ message: '❌ ফাইল প্রসেস করতে সমস্যা হয়েছে। চ্যানেলে বট অ্যাডমিন আছে কিনা চেক করুন।' });
    }
  }
}, new NewMessage({ incoming: true }));

app.get('/dl/:id/:filename', async (req, res) => {
  try {
    const msgId = Number(req.params.id);
    const messages = await client.getMessages(BIN_CHANNEL, { ids: [msgId] });
    if (!messages || messages.length === 0 || !messages[0]?.media) return res.status(404).send('ফাইল পাওয়া যায়নি!');

    const media = messages[0].media;
    const doc = media.document;
    let fileName = req.params.filename || 'document.pdf';
    let fileSize = doc ? Number(doc.size) : 0;
    let mimeType = doc?.mimeType || 'application/pdf';

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      });

      for await (const chunk of client.iterDownload({ file: media, offset: BigInt(start), limit: chunksize, chunkSize: 512 * 1024 })) {
        res.write(chunk);
      }
      res.end();
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Accept-Ranges': 'bytes',
      });

      for await (const chunk of client.iterDownload({ file: media, chunkSize: 512 * 1024 })) {
        res.write(chunk);
      }
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).send('ডাউনলোড এরর');
  }
});

app.get('/', (req, res) => res.send('বট সক্রিয় আছে!'));

app.listen(PORT, async () => {
  console.log(`Port ${PORT}-এ সার্ভার চলছে`);
  await client.start({ botAuthToken: BOT_TOKEN });
  console.log('বট সফলভাবে কানেক্ট হয়েছে!');
});