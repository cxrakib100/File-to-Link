const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Api } = require('telegram');
const { GoogleGenAI } = require('@google/genai');

let gplay = null;
try {
  const gp = require('google-play-scraper');
  gplay = gp.search ? gp : (gp.default || gp);
} catch (e) {}

// ফ্রি জেমিনি এআই ইনিশিয়ালাইজেশন (লোগো স্ক্যানের জন্য)
const aiApiKey = process.env.GEMINI_API_KEY || '';
const ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey }) : null;

// ১. স্মার্ট ও ফাজি সার্চ (একাধিক অ্যাপ খোঁজা)
async function searchPlayStoreMulti(query) {
  let list = [];
  if (gplay && typeof gplay.search === 'function') {
    try {
      list = await gplay.search({ term: query, num: 5 });
    } catch (e) {}
  }

  // লাইব্রেরি মিস করলে সরাসরি প্লে স্টোর থেকে লাইভ রেজাল্ট আনা
  if (!list || list.length === 0) {
    try {
      const res = await axios.get(`https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=bn`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const matches = [...res.data.matchAll(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g)];
      const uniqueIds = [...new Set(matches.map(m => m[1]))].slice(0, 5);
      
      for (const id of uniqueIds) {
        try {
          const d = await gplay.app({ appId: id });
          list.push({ appId: id, title: d.title, developer: d.developer, scoreText: d.scoreText || '4.0' });
        } catch (err) {}
      }
    } catch (e) {}
  }
  return list;
}

// ২. ছবির লোগো থেকে অ্যাপ চেনার এআই ইঞ্জিন
async function identifyAppFromPhoto(photoBuffer) {
  if (!ai) return null;
  try {
    const base64Image = photoBuffer.toString('base64');
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
            { text: "Identify the Android app shown in this logo/icon/screenshot. Respond ONLY with the official App Name or Package ID. If it's an old logo, identify which app it originally belonged to." }
          ]
        }
      ]
    });
    return response.text ? response.text.trim() : null;
  } catch (err) {
    return null;
  }
}

// ৩. কোর ডাউনলোড ও ডেলিভারি ফাংশন
async function executeApkDownload(client, chatId, appId) {
  let statusMsg = null;
  let tempFilePath = null;

  try {
    statusMsg = await client.sendMessage(chatId, {
      message: '⏳ <b>অ্যাপের লেটেস্ট ফাইল প্রসেস করা হচ্ছে...</b>',
      parseMode: 'html'
    });

    let appTitle = appId;
    let appVersion = 'Latest';
    let lastUpdated = 'আজকেই আপডেট করা';

    if (gplay && typeof gplay.app === 'function') {
      try {
        const details = await gplay.app({ appId });
        appTitle = details.title || appTitle;
        if (details.version && details.version !== 'Varies with device') appVersion = details.version;
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
      text: `📦 <b>অ্যাপ:</b> ${appTitle}\n🆔 <code>${appId}</code>\n⏳ <b>ডিভাইস ইনকম্প্যাটিবিলিটি বাইপাস করে ডাউনলোড হচ্ছে...</b>`,
      parseMode: 'html'
    });

    // গ্লোবাল মাল্টি-সিডিএন (ডিভাইস আর্কিটেকচার লক বাইপাস)
    const timestamp = Date.now();
    const downloadSources = [
      `https://d.apkpure.net/b/APK/${appId}?version=latest&t=${timestamp}`,
      `https://d.apkpure.com/b/APK/${appId}?version=latest&t=${timestamp}`,
      `https://d.apkpure.net/b/XAPK/${appId}?version=latest&t=${timestamp}`,
      `https://d.apkpure.com/b/XAPK/${appId}?version=latest&t=${timestamp}`
    ];

    let downloaded = false;

    for (const url of downloadSources) {
      const isXapk = url.includes('/XAPK/');
      const candidatePath = path.join(os.tmpdir(), `${appId}_${timestamp}.${isXapk ? 'xapk' : 'apk'}`);
      
      try {
        const writer = fs.createWriteStream(candidatePath);
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://apkpure.com/'
          },
          timeout: 60000,
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

        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).size > 1024 * 1024) {
          // XAPK হলে আনজিপ করে আসল .apk বের করা
          if (isXapk) {
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
        message: '⚠️ <b>ডাউনলোড ব্যর্থ হয়েছে!</b> অ্যাপটি পেইড অথবা প্লে স্টোরের নিজস্ব সিডিএন-এ সীমাবদ্ধ।',
        parseMode: 'html'
      });
      return;
    }

    const fileSizeMB = (fs.statSync(tempFilePath).size / (1024 * 1024)).toFixed(2);
    const cleanFileName = `${appTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'App'}.apk`;

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📤 <b>ডাউনলোড সম্পন্ন!</b> (${fileSizeMB} MB)\n🚀 <b>টেলিগ্রামে ফাইল পাঠানো হচ্ছে...</b>`,
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

    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: caption,
      parseMode: 'html',
      forceDocument: true,
      mimeType: 'application/vnd.android.package-archive',
      attributes: [
        new Api.DocumentAttributeFilename({ fileName: cleanFileName })
      ],
      workers: 4
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

// ৪. ইউজার রিকোয়েস্ট হ্যান্ডলার (নাম, লিংক বা একাধিক তালিকা প্রদর্শন)
async function handlePlayStoreDownload(client, chatId, inputQuery) {
  const cleanInput = inputQuery.trim();

  // সরাসরি লিংক আসলে কোনো তালিকা ছাড়াই ডাউনলোড
  const linkMatch = cleanInput.match(/id=([a-zA-Z0-9._]+)/);
  if (linkMatch) {
    return await executeApkDownload(client, chatId, linkMatch[1]);
  }
  if (cleanInput.includes('.') && !cleanInput.includes(' ')) {
    return await executeApkDownload(client, chatId, cleanInput);
  }

  // নাম দিয়ে সার্চ
  const statusMsg = await client.sendMessage(chatId, {
    message: '🔍 <b>প্লে স্টোরে সার্চ ও যাচাই করা হচ্ছে...</b>',
    parseMode: 'html'
  });

  const apps = await searchPlayStoreMulti(cleanInput);

  if (!apps || apps.length === 0) {
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    await client.sendMessage(chatId, {
      message: '❌ <b>কোনো অ্যাপ খুঁজে পাওয়া যায়নি! অনুগ্রহ করে সঠিক নাম বা লিংক দিন।</b>',
      parseMode: 'html'
    });
    return;
  }

  // যদি একটিই নির্দিষ্ট অ্যাপ পাওয়া যায়, সরাসরি ডাউনলোড
  if (apps.length === 1) {
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    return await executeApkDownload(client, chatId, apps[0].appId);
  }

  // যদি একাধিক অ্যাপ পাওয়া যায়, চমৎকার ইনলাইন বাটন তালিকা পাঠানো
  let listText = `🔍 <b>"${cleanInput}" সম্পর্কিত পাওয়া অ্যাপসমূহ:</b>\n`;
  listText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  const buttons = [];
  apps.slice(0, 4).forEach((app, idx) => {
    listText += `<b>${idx + 1}. ${app.title}</b>\n`;
    listText += `🏢 <i>${app.developer || 'Developer'}</i> | ⭐ ${app.scoreText || '4.0'}\n\n`;
    
    buttons.push([
      new Api.KeyboardButtonCallback({
        text: `📥 ${idx + 1}. ${app.title.substring(0, 25)}`,
        data: Buffer.from(`dl_${app.appId.substring(0, 50)}`)
      })
    ]);
  });

  listText += `👇 <b>আপনার কাঙ্ক্ষিত অ্যাপটি বেছে নিতে নিচের বাটনে চাপ দিন:</b>`;

  await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
  await client.sendMessage(chatId, {
    message: listText,
    parseMode: 'html',
    buttons: buttons
  });
}

// ফটো হ্যান্ডলার
async function handlePhotoSearch(client, message) {
  const chatId = message.chatId;
  const status = await client.sendMessage(chatId, {
    message: '🤖 <b>AI দ্বারা অ্যাপের লোগো স্ক্যান করা হচ্ছে...</b>',
    parseMode: 'html'
  });

  try {
    const buffer = await client.downloadMedia(message);
    const detectedName = await identifyAppFromPhoto(buffer);

    if (!detectedName) {
      await client.editMessage(chatId, {
        message: status.id,
        text: '❌ <b>ছবি থেকে কোনো অ্যাপ সনাক্ত করা যায়নি। অনুগ্রহ করে অ্যাপের নামটি টাইপ করুন।</b>',
        parseMode: 'html'
      });
      return;
    }

    await client.editMessage(chatId, {
      message: status.id,
      text: `🎯 <b>লোগো সনাক্ত হয়েছে:</b> <i>"${detectedName}"</i>\n🔍 প্লে স্টোর থেকে অ্যাপ সংগ্রহ করা হচ্ছে...`,
      parseMode: 'html'
    });

    await handlePlayStoreDownload(client, chatId, detectedName);

  } catch (err) {
    await client.editMessage(chatId, {
      message: status.id,
      text: '⚠️ <b>লোগো স্ক্যান করতে সমস্যা হয়েছে।</b>',
      parseMode: 'html'
    });
  }
}

module.exports = { handlePlayStoreDownload, executeApkDownload, handlePhotoSearch };
