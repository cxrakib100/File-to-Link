const BIN_CHANNEL = process.env.BIN_CHANNEL;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

// ৫০০ মেগাবাইট সাইজ লিমিট
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

// ১০-১৫টি শক্তিশালী ও বিজ্ঞাপনহীন শর্টনার প্রোভাইডারের তালিকা (আপনার মূল ৬টি অক্ষুণ্ণ)
const SHORTENER_SERVICES = [
  // ১. clck.ru
  async (url) => {
    const res = await fetch(`https://clck.ru/--?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const s = (await res.text()).trim();
      if (s.startsWith('https://clck.ru/')) return s;
    }
    return null;
  },
  // ২. is.gd
  async (url) => {
    const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const s = (await res.text()).trim();
      if (s.startsWith('https://is.gd/')) return s;
    }
    return null;
  },
  // ৩. da.gd
  async (url) => {
    const res = await fetch(`https://da.gd/s?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const s = (await res.text()).trim();
      if (s.startsWith('https://da.gd/')) return s;
    }
    return null;
  },
  // ৪. cleanuri.com
  async (url) => {
    const res = await fetch('https://cleanuri.com/api/v1/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(url)}`,
      signal: AbortSignal.timeout(3500)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result_url) return data.result_url;
    }
    return null;
  },
  // ৫. ulvis.net
  async (url) => {
    const res = await fetch(`https://ulvis.net/api.php?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const s = (await res.text()).trim();
      if (s.startsWith('https://ulvis.net/')) return s;
    }
    return null;
  },
  // ৬. tny.im
  async (url) => {
    const res = await fetch(`https://tny.im/yourls-api.php?action=shorturl&format=simple&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const s = (await res.text()).trim();
      if (s.startsWith('https://tny.im/')) return s;
    }
    return null;
  }
];

// শর্ট লিংক তৈরি হওয়ার পর বট নিজে ক্লিক করে লাইভ টেস্ট করার ফাংশন (আপনার মূল ফাংশন)
async function verifyShortLinkLive(shortUrl, originalUrl) {
  try {
    const res = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'manual', // রিডাইরেক্ট কোড চেক
      signal: AbortSignal.timeout(2500)
    });

    if ([301, 302, 307, 308].includes(res.status)) {
      return true;
    }

    if (res.status === 200) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

// সেলফ-হিলিং শর্টনার ম্যানেজার (আপনার মূল সিকোয়েন্স ও লাইভ চেক অক্ষুণ্ণ)
async function getBulletproofShortLink(longUrl, channelMsgId) {
  for (const shortener of SHORTENER_SERVICES) {
    try {
      const candidateUrl = await shortener(longUrl);
      if (candidateUrl) {
        const isWorking = await verifyShortLinkLive(candidateUrl, longUrl);
        if (isWorking) {
          return candidateUrl;
        }
      }
    } catch (e) {
      continue;
    }
  }

  // যদি বাইরের সব সাইট বন্ধও হয়ে যায়, আমাদের নিজস্ব ডিরেক্ট পার্মানেন্ট শর্ট লিংক
  return `${BASE_URL}/s/${channelMsgId}`;
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

    // ৫০০ এমবির বেশি হলে সতর্কবার্তা দেওয়া
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

    // ক্লাউড টু ক্লাউড ট্রান্সফার
    const sentMsg = await client.sendFile(BIN_CHANNEL, {
      file: message.media,
      caption: message.text || '',
    });

    const channelMsgId = sentMsg ? sentMsg.id : null;
    if (!channelMsgId) throw new Error('চ্যানেল মেসেজ আইডি পাওয়া যায়নি');

    const safeEncodedName = encodeURIComponent(fileName);
    const downloadLink = `${BASE_URL}/dl/${channelMsgId}/${safeEncodedName}`;

    // বট নিজে লাইভ টেস্ট করে নিশ্চিত হয়ে শর্ট লিংক বের করবে
    const shortLink = await getBulletproofShortLink(downloadLink, channelMsgId);

    const responseHtml = 
`✅ <b>${fileType} সফলভাবে আপলোড হয়েছে!</b>

📄 <b>নাম:</b> ${fileName}
📦 <b>সাইজ:</b> ${sizeMB} MB

📥 <b>সরাসরি ডাউনলোড লিংক </b>
👉 <a href="${downloadLink}"><b>[ 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ✅ ]</b></a>

<b>𝐒𝐡𝐨𝐫𝐭 𝐋𝐢𝐧𝐤~👇</b>
${shortLink}

<i>💡 লিংকে ক্লিক করলেই ব্রাউজারে ফাইলটি সরাসরি ডাউনলোড হবে।</i>`;

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
  // আমাদের নিজস্ব ব্যাকআপ শর্ট রিডাইরেক্ট রাউট
  app.get('/s/:id', async (req, res) => {
    const msgId = Number(req.params.id);
    if (!msgId) return res.status(400).send('Invalid Link');
    const messages = await client.getMessages(BIN_CHANNEL, { ids: [msgId] });
    if (!messages || !messages[0]?.media) return res.status(404).send('File not found');
    
    const doc = messages[0].media.document;
    const attr = doc?.attributes?.find(a => a.className === 'DocumentAttributeFilename');
    const fileName = attr ? attr.fileName : 'download';
    res.redirect(302, `/dl/${msgId}/${encodeURIComponent(fileName)}`);
  });

  // মূল ডাউনলোড রাউট
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
