const BIN_CHANNEL = process.env.BIN_CHANNEL;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

// ৫০০ মেগাবাইট সাইজ লিমিট
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

// কোনো বিজ্ঞাপন ছাড়া সরাসরি ১০০% ডিরেক্ট রিডাইরেক্ট শর্টনার ইঞ্জিন
async function getVerifiedShortLink(longUrl) {
  // ১. is.gd ইঞ্জিন (সম্পূর্ণ বিজ্ঞাপনহীন, সরাসরি ৩০১ রিডাইরেক্ট দিয়ে ডাউনলোড শুরু করে)
  try {
    const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const short = (await res.text()).trim();
      if (short.startsWith('https://is.gd/')) return short;
    }
  } catch (e) {}

  // ২. clck.ru ইঞ্জিন (ব্যাকআপ নো-অ্যাড ডিরেক্ট রিডাইরেক্ট)
  try {
    const res = await fetch(`https://clck.ru/--?url=${encodeURIComponent(longUrl)}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const short = (await res.text()).trim();
      if (short.startsWith('https://clck.ru/')) return short;
    }
  } catch (e) {}

  // ৩. da.gd ইঞ্জিন (৩য় নো-অ্যাড ব্যাকআপ)
  try {
    const res = await fetch(`https://da.gd/s?url=${encodeURIComponent(longUrl)}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const short = (await res.text()).trim();
      if (short.startsWith('https://da.gd/')) return short;
    }
  } catch (e) {}

  return longUrl;
}

// ফাইল গ্রহণ করে লিংক তৈরি করা
async function processFileUpload(client, message) {
  try {
    let fileName = 'file.bin';
    let fileSize = 0;
    let fileType = 'ফাইল';

    if (message.media.document) {
      const doc = message.media.document;
      fileSize = Number(doc.size);
      const attr = doc.attributes?.find((a) => a.className === 'DocumentAttributeFilename');
      fileName = attr ? attr.fileName : (doc.mimeType === 'application/pdf' ? 'document.pdf' : 'file.bin');
      
      if (fileName.endsWith('.apk')) fileType = 'অ্যাপ্লিকেশন (APK)';
      else if (fileName.endsWith('.pdf')) fileType = 'পিডিএফ (PDF)';
      else if (fileName.endsWith('.zip') || fileName.endsWith('.rar')) fileType = 'জিপ ফাইল (ZIP)';
      else if (fileName.endsWith('.mp4') || fileName.endsWith('.mkv')) fileType = 'ভিডিও (Video)';
      else fileType = 'ডকুমেন্ট';
    } else if (message.media.photo) {
      fileName = `photo_${Date.now()}.jpg`;
      fileType = 'ছবি (Photo)';
    }

    const sizeMB = fileSize ? (fileSize / (1024 * 1024)).toFixed(2) : '0';

    // ১. ৫০০ এমবির বেশি হলে সতর্কবার্তা দেওয়া
    if (fileSize > MAX_FILE_SIZE) {
      await message.reply({
        message: 
`⚠️ <b>ফাইল সাইজ সীমা অতিক্রম করেছে!</b>
━━━━━━━━━━━━━━━━━━━━━━
📦 <b>আপনার ফাইলের সাইজ:</b> ${sizeMB} MB
🚫 <b>সর্বোচ্চ সীমা:</b> ৫০০.০০ MB

দুঃখিত! বটটিতে সর্বোচ্চ <b>৫০০ মেগাবাইট (500 MB)</b> পর্যন্ত ফাইল আপলোড করার অনুমতি রয়েছে। অনুগ্রহ করে ৫০০ এমবির চেয়ে ছোট ফাইল পাঠান।
━━━━━━━━━━━━━━━━━━━━━━`,
        parseMode: 'html',
      });
      return;
    }

    // ২. ক্লাউড টু ক্লাউড ট্রান্সফার
    const sentMsg = await client.sendFile(BIN_CHANNEL, {
      file: message.media,
      caption: message.text || '',
    });

    const channelMsgId = sentMsg ? sentMsg.id : null;

    if (!channelMsgId) {
      throw new Error('চ্যানেল মেসেজ আইডি পাওয়া যায়নি');
    }

    // ডাউনলোড লিংক তৈরি
    const safeEncodedName = encodeURIComponent(fileName);
    const downloadLink = `${BASE_URL}/dl/${channelMsgId}/${safeEncodedName}`;

    // ৩. বিজ্ঞাপনহীন সরাসরি লাইভ শর্ট লিংক তৈরি করা
    const shortLink = await getVerifiedShortLink(downloadLink);

    // HTML ফরম্যাটিং যাতে হাইপারলিংক কখনো না ভাঙে
    const responseHtml = 
`✅ <b>${fileType} সফলভাবে আপলোড হয়েছে!</b>

📄 <b>নাম:</b> ${fileName}
📦 <b>সাইজ:</b> ${sizeMB} MB

📥 <b>সরাসরি ডাউনলোড লিংক (One-Click):</b>
👉 <a href="${downloadLink}"><b>[ 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ✅ ]</b></a>

<b>𝐒𝐡𝐨𝐫𝐭 𝐋𝐢𝐧𝐤~👇</b>
${shortLink}

💡 <i>লিংকে ক্লিক করলেই ব্রাউজারে ফাইলটি সরাসরি নামা শুরু হবে।</i>`;

    await message.reply({
      message: responseHtml,
      parseMode: 'html',
    });

  } catch (err) {
    console.error('File Upload error:', err);
    await message.reply({ message: '❌ ফাইল প্রসেস করতে সমস্যা হয়েছে। চ্যানেলে বট অ্যাডমিন আছে কিনা চেক করুন।' });
  }
}

// ব্রাউজারে ৫০০ এমবি পর্যন্ত ফাইল ১-ক্লিকে ডাউনলোড দেওয়ার স্ট্রিমিং রাউট
function setupDownloadRoute(app, client) {
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

      // বড় ফাইলের জন্য ৫১২ কেবি বাঙ্ক স্ট্রিমিং
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
      console.error('Download stream error:', err);
      if (!res.headersSent) res.status(500).send('ডাউনলোড সম্পন্ন করা যায়নি।');
    }
  });
}

module.exports = { processFileUpload, setupDownloadRoute };
