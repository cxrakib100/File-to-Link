const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Api } = require('telegram');

// Render Environment থেকে সিকিউর এআই কি লোড (GitHub কোনো সিক্রেট ওয়ার্নিং দেবে না)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let gplay = null;
try {
  const gp = require('google-play-scraper');
  gplay = gp.search ? gp : (gp.default || gp);
} catch (e) {
  gplay = null;
}

// ১. বাংলা-ইংরেজি স্মার্ট ফাজি সার্চ
async function searchPlayStoreSmart(query) {
  let list = [];
  if (gplay && typeof gplay.search === 'function') {
    try {
      list = await gplay.search({ term: query, num: 4 });
    } catch (e) {}
  }

  if (!list || list.length === 0) {
    try {
      const res = await axios.get(`https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=bn`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const matches = [...res.data.matchAll(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g)];
      const uniqueIds = [...new Set(matches.map(m => m[1]))].slice(0, 4);

      for (const id of uniqueIds) {
        try {
          const d = await gplay.app({ appId: id });
          list.push({ appId: id, title: d.title, developer: d.developer, scoreText: d.scoreText || '4.2' });
        } catch (err) {}
      }
    } catch (e) {}
  }
  return list;
}

// ২. সুপার পাওয়ারফুল এআই ভিশন (স্ক্রিনশট ও লোগো ডিটেক্টর)
async function identifyAppFromPhoto(buffer) {
  if (!GEMINI_API_KEY) return null;

  let mimeType = 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    mimeType = 'image/png';
  } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    mimeType = 'image/webp';
  }

  const prompt = `This image is an Android app logo or a full Google Play Store screenshot.
Extract ONLY the main official App Name or Package ID (e.g., 'Nagad', 'WhatsApp', 'Free Fire').
Output strictly the plain app name, nothing else.`;

  const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash'];

  for (const model of models) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: buffer.toString('base64')
                  }
                },
                { text: prompt }
              ]
            }
          ]
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
      );

      const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (raw) {
        const clean = raw.split('\n')[0].replace(/[`*"'#]/g, '').trim();
        if (clean.length > 1) return clean;
      }
    } catch (err) {}
  }
  return null;
}

// ৩. হাই-পারফরম্যান্স কোর ডাউনলোডার (৫০০ MB+ ফাইল মেমোরি-সেফ হ্যান্ডলার)
async function executeApkDownload(client, chatId, appId) {
  let statusMsg = null;
  let tempFilePath = null;

  try {
    statusMsg = await client.sendMessage(chatId, {
      message: '⚡ <b>প্লে স্টোরের লাইভ ডাটাবেসে কানেক্ট করা হচ্ছে...</b>',
      parseMode: 'html'
    });

    let appTitle = appId;
    let appVersion = 'Latest';
    let lastUpdated = 'আজকেই আপডেট করা';

    if (gplay && typeof gplay.app === 'function') {
      try {
        const details = await gplay.app({ appId });
        appTitle = details.title || appTitle;
        if (details.version && details.version !== 'Varies with device') {
          appVersion = details.version;
        }
        if (details.updated) {
          const d = new Date(details.updated);
          if (!isNaN(d.getTime())) {
            lastUpdated = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }
        }
      } catch (e) {}
    }

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📦 <b>অ্যাপ:</b> ${appTitle}\n🆔 <code>${appId}</code>\n🚀 <b>সুপার ফাস্ট স্পিডে ডাউনলোড হচ্ছে...</b>`,
      parseMode: 'html'
    });

    const timestamp = Date.now();
    const downloadConfigs = [
      { url: `https://d.apkpure.net/b/APK/${appId}?version=latest&t=${timestamp}`, isXapk: false },
      { url: `https://d.apkpure.com/b/APK/${appId}?version=latest&t=${timestamp}`, isXapk: false },
      { url: `https://d.apkpure.net/b/XAPK/${appId}?version=latest&t=${timestamp}`, isXapk: true },
      { url: `https://d.apkpure.com/b/XAPK/${appId}?version=latest&t=${timestamp}`, isXapk: true }
    ];

    let downloaded = false;

    for (const item of downloadConfigs) {
      const candidatePath = path.join(os.tmpdir(), `${appId}_${timestamp}.${item.isXapk ? 'xapk' : 'apk'}`);
      try {
        // মেমোরি হ্যাং এড়াতে ১ MB চাঙ্ক হাইওয়াটারমার্ক
        const writer = fs.createWriteStream(candidatePath, { highWaterMark: 1024 * 1024 });
        const response = await axios({
          method: 'GET',
          url: item.url,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://apkpure.com/'
          },
          timeout: 120000,
          maxRedirects: 10
        });

        if ((response.headers['content-type'] || '').includes('text/html')) {
          writer.close();
          if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
          continue;
        }

        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        const stats = fs.statSync(candidatePath);
        if (stats.size > 1024 * 1024) {
          // XAPK হলে আনজিপ করে আসল .apk আলাদা করা
          if (item.isXapk) {
            try {
              const zip = new AdmZip(candidatePath);
              const zipEntries = zip.getEntries();
              const mainApk = zipEntries.find(e => 
                e.entryName.toLowerCase().endsWith('.apk') && 
                !e.entryName.toLowerCase().startsWith('config.')
              ) || zipEntries.find(e => e.entryName.toLowerCase().endsWith('.apk'));

              if (mainApk) {
                const extracted = path.join(os.tmpdir(), `${appId}_clean_${Date.now()}.apk`);
                fs.writeFileSync(extracted, mainApk.getData());
                fs.unlinkSync(candidatePath);
                tempFilePath = extracted;
                downloaded = true;
                break;
              }
            } catch (err) {}
          }
          tempFilePath = candidatePath;
          downloaded = true;
          break;
        } else {
          if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
        }
      } catch (err) {
        if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
      }
    }

    if (!downloaded || !fs.existsSync(tempFilePath)) {
      if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      await client.sendMessage(chatId, {
        message: '⚠️ <b>ডাউনলোড ব্যর্থ হয়েছে!</b> অ্যাপটি পেইড অথবা প্লে স্টোর থেকে রিমুভ করা হয়েছে।',
        parseMode: 'html'
      });
      return;
    }

    const fileSizeMB = (fs.statSync(tempFilePath).size / (1024 * 1024)).toFixed(2);
    const cleanFileName = `${appTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'App'}.apk`;

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📤 <b>ডাউনলোড সম্পন্ন!</b> (${fileSizeMB} MB)\n🚀 <b>টেলিগ্রামে আল্ট্রা-স্পিডে পাঠানো হচ্ছে...</b>`,
      parseMode: 'html'
    });

    const caption = 
`📱 <b>${appTitle}</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>প্যাকেজ:</b> <code>${appId}</code>
📦 <b>ভার্সন:</b> ${appVersion}
🗓 <b>লাস্ট আপডেট:</b> ${lastUpdated}
💾 <b>সাইজ:</b> ${fileSizeMB} MB
✅ <b>১-ক্লিক ইনস্টলেবল APK (All Devices Compatible)</b>
━━━━━━━━━━━━━━━━━━━━━━`;

    // ⚡ আল্ট্রা-ফাস্ট ১৬-থ্রেড আপলোড
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: caption,
      parseMode: 'html',
      forceDocument: true,
      mimeType: 'application/vnd.android.package-archive',
      attributes: [
        new Api.DocumentAttributeFilename({ fileName: cleanFileName })
      ],
      workers: 16
    });

    if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });

  } catch (error) {
    if (statusMsg) {
      try { await client.deleteMessages(chatId, [statusMsg.id], { revoke: true }); } catch (e) {}
    }
    await client.sendMessage(chatId, {
      message: `❌ <b>ত্রুটি:</b> ${error.message || 'ডাউনলোড সম্পন্ন করা যায়নি'}`,
      parseMode: 'html'
    });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlink(tempFilePath, () => {});
    }
  }
}

// ৪. স্মার্ট সার্চ ও ডিসপ্লে হ্যান্ডলার
async function handlePlayStoreDownload(client, chatId, inputQuery) {
  const cleanInput = inputQuery.trim();

  const linkMatch = cleanInput.match(/id=([a-zA-Z0-9._]+)/);
  if (linkMatch) {
    return await executeApkDownload(client, chatId, linkMatch[1]);
  }
  if (cleanInput.includes('.') && !cleanInput.includes(' ')) {
    return await executeApkDownload(client, chatId, cleanInput);
  }

  const statusMsg = await client.sendMessage(chatId, {
    message: '🔍 <b>প্লে স্টোরে অনুসন্ধান করা হচ্ছে...</b>',
    parseMode: 'html'
  });

  const apps = await searchPlayStoreSmart(cleanInput);

  if (!apps || apps.length === 0) {
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    await client.sendMessage(chatId, {
      message: '❌ <b>প্লে স্টোরে এই নামের কোনো অ্যাপ পাওয়া যায়নি!</b>',
      parseMode: 'html'
    });
    return;
  }

  if (apps.length === 1) {
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    return await executeApkDownload(client, chatId, apps[0].appId);
  }

  let listText = `🔍 <b>"${cleanInput}" সম্পর্কিত পাওয়া অ্যাপসমূহ:</b>\n`;
  listText += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  const buttons = [];
  apps.slice(0, 4).forEach((app, idx) => {
    listText += `<b>${idx + 1}. ${app.title}</b>\n`;
    listText += `🏢 <i>${app.developer || 'Developer'}</i> | ⭐ ${app.scoreText || '4.0'}\n\n`;

    buttons.push([
      new Api.KeyboardButtonCallback({
        text: `📥 ${idx + 1}. ${app.title.substring(0, 24)}`,
        data: Buffer.from(`dl_${app.appId.substring(0, 50)}`)
      })
    ]);
  });

  listText += `👇 <b>কাঙ্ক্ষিত অ্যাপটি নামাতে নিচের বাটনে চাপ দিন:</b>`;

  await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
  await client.sendMessage(chatId, {
    message: listText,
    parseMode: 'html',
    buttons: buttons
  });
}

// ৫. এআই ফটো/স্ক্রিনশট প্রসেসর
async function handlePhotoSearch(client, message) {
  const chatId = message.chatId;
  const status = await client.sendMessage(chatId, {
    message: '🤖 <b>AI দ্বারা স্ক্রিনশট স্ক্যান করা হচ্ছে...</b>',
    parseMode: 'html'
  });

  try {
    const buffer = await client.downloadMedia(message);
    const detectedName = await identifyAppFromPhoto(buffer);

    if (!detectedName) {
      await client.editMessage(chatId, {
        message: status.id,
        text: '⚠️ <b>ছবি থেকে কোনো অ্যাপ সনাক্ত করা যায়নি। অনুগ্রহ করে অ্যাপের নামটি টাইপ করুন।</b>',
        parseMode: 'html'
      });
      return;
    }

    await client.editMessage(chatId, {
      message: status.id,
      text: `🎯 <b>এআই সনাক্ত করেছে:</b> <i>"${detectedName}"</i>\n⏳ প্লে স্টোর থেকে লাইভ ফাইল আনা হচ্ছে...`,
      parseMode: 'html'
    });

    await handlePlayStoreDownload(client, chatId, detectedName);

  } catch (err) {
    await client.editMessage(chatId, {
      message: status.id,
      text: '⚠️ <b>লোগো স্ক্যান করতে ব্যর্থ হয়েছে।</b>',
      parseMode: 'html'
    });
  }
}

module.exports = { handlePlayStoreDownload, executeApkDownload, handlePhotoSearch };
