const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Api } = require('telegram');

// Render Environment থেকে সিকিউর এআই কি
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let gplay = null;
try {
  const gp = require('google-play-scraper');
  gplay = gp.search ? gp : (gp.default || gp);
} catch (e) {
  gplay = null;
}

// ১. বাংলা ও ইংরেজি স্মার্ট গ্লোবাল সার্চ (কান্ট্রি লক বাইপাস)
async function searchPlayStoreGlobal(query) {
  if (gplay && typeof gplay.search === 'function') {
    try {
      const results = await gplay.search({ term: query, num: 2 });
      if (results && results.length > 0) {
        return { appId: results[0].appId, title: results[0].title };
      }
    } catch (e) {}
  }

  // সরাসরি প্লে স্টোর ওয়েব স্ক্র্যাপার
  try {
    const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps`;
    const res = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    });
    const match = res.data.match(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/);
    if (match) {
      return { appId: match[1], title: query };
    }
  } catch (err) {}

  return null;
}

// ২. Aptoide ব্যাকআপ সিডিএন
async function getAptoideDownload(packageId) {
  try {
    const res = await axios.get(`https://ws75.aptoide.com/api/7/apps/search?query=${packageId}&limit=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    const list = res.data?.datalist?.list;
    if (list && list.length > 0) {
      const match = list.find(item => item.package === packageId) || list[0];
      if (match && match.file && match.file.path) {
        return {
          url: match.file.path,
          name: match.name,
          version: match.file.vername || 'Latest'
        };
      }
    }
  } catch (e) {}
  return null;
}

// ৩. সুপার এআই ভিশন (নতুন AQ. কি প্রোটোকল ও ডুয়াল মেথড ব্যাকআপ)
async function identifyAppFromPhoto(buffer) {
  if (!GEMINI_API_KEY) return null;

  let mimeType = 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    mimeType = 'image/png';
  } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    mimeType = 'image/webp';
  }

  const base64Data = buffer.toString('base64');
  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          {
            text: "This image is an Android app logo, icon, or Google Play Store screenshot. Name the official app (e.g. Nagad, WhatsApp, Facebook). Output strictly ONLY the clean app name or Google Play package ID, with no punctuation or extra words."
          }
        ]
      }
    ]
  };

  const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash'];

  for (const model of models) {
    // মেথড ১: x-goog-api-key হেডার + URL প্যারামিটার
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY
          },
          timeout: 20000
        }
      );

      const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (raw) {
        const clean = raw.split('\n')[0].replace(/[`*"'#]/g, '').trim();
        if (clean.length > 1) return clean;
      }
    } catch (err1) {
      // মেথড ২: Authorization Bearer হেডার (নতুন AQ. প্রোটোকল সাপোর্ট)
      try {
        const response2 = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${GEMINI_API_KEY}`
            },
            timeout: 20000
          }
        );

        const raw2 = response2.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw2) {
          const clean2 = raw2.split('\n')[0].replace(/[`*"'#]/g, '').trim();
          if (clean2.length > 1) return clean2;
        }
      } catch (err2) {}
    }
  }

  return null;
}

// ৪. আল্ট্রা-ফাস্ট কোর ডাউনলোডার (১৬-থ্রেড প্যারালাল আপলোড ও নো-হ্যাং সিস্টেম)
async function executeApkDownload(client, chatId, appId) {
  let statusMsg = null;
  let tempFilePath = null;

  try {
    statusMsg = await client.sendMessage(chatId, {
      message: '⚡ <b>প্লে স্টোর থেকে লাইভ ডাটা সংগ্রহ করা হচ্ছে...</b>',
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

    // ১. প্রথম চেষ্টা: APKPure সিডিএন
    for (const item of downloadConfigs) {
      const candidatePath = path.join(os.tmpdir(), `${appId}_${timestamp}.${item.isXapk ? 'xapk' : 'apk'}`);
      try {
        const writer = fs.createWriteStream(candidatePath, { highWaterMark: 1024 * 1024 });
        const response = await axios({
          method: 'GET',
          url: item.url,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://apkpure.com/'
          },
          timeout: 90000,
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

    // ২. দ্বিতীয় চেষ্টা: Aptoide গ্লোবাল ব্যাকআপ
    if (!downloaded) {
      const aptoideApp = await getAptoideDownload(appId);
      if (aptoideApp && aptoideApp.url) {
        const candidatePath = path.join(os.tmpdir(), `${appId}_${Date.now()}.apk`);
        try {
          const writer = fs.createWriteStream(candidatePath);
          const response = await axios({
            method: 'GET',
            url: aptoideApp.url,
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 60000
          });

          response.data.pipe(writer);
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });

          if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).size > 1024 * 1024) {
            tempFilePath = candidatePath;
            downloaded = true;
            if (aptoideApp.version) appVersion = aptoideApp.version;
          }
        } catch (e) {
          if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
        }
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

    // ১৬-থ্রেডে সুপারফাস্ট টেলিগ্রাম আপলোড
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

// ৫. সরাসরি ডাউনলোড হ্যান্ডলার (কোনো বাটন বা তালিকা নেই)
async function handlePlayStoreDownload(client, chatId, inputQuery) {
  const cleanInput = inputQuery.trim();

  // সরাসরি লিংক আসলে সরাসরি ডাউনলোড
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

  const found = await searchPlayStoreGlobal(cleanInput);

  if (!found || !found.appId) {
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    await client.sendMessage(chatId, {
      message: '❌ <b>প্লে স্টোরে এই নামের কোনো অ্যাপ খুঁজে পাওয়া যায়নি!</b>',
      parseMode: 'html'
    });
    return;
  }

  await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
  
  // সরাসরি ডাউনলোড শুরু (কোনো তালিকা বা বাটন ছাড়াই)
  return await executeApkDownload(client, chatId, found.appId);
}

// ৬. ফটো/লোগো থেকে সরাসরি ডাউনলোড হ্যান্ডলার
async function handlePhotoSearch(client, message) {
  const chatId = message.chatId;
  const status = await client.sendMessage(chatId, {
    message: '🤖 <b>AI দ্বারা অ্যাপ লোগো স্ক্যান করা হচ্ছে...</b>',
    parseMode: 'html'
  });

  try {
    const buffer = await client.downloadMedia(message);
    const detectedName = await identifyAppFromPhoto(buffer);

    if (!detectedName) {
      await client.editMessage(chatId, {
        message: status.id,
        text: '⚠️ <b>ছবি থেকে কোনো অ্যাপ সনাক্ত করা যায়নি। অনুগ্রহ করে অ্যাপের নামটি সরাসরি টাইপ করুন।</b>',
        parseMode: 'html'
      });
      return;
    }

    await client.editMessage(chatId, {
      message: status.id,
      text: `🎯 <b>এআই সনাক্ত করেছে:</b> <i>"${detectedName}"</i>\n⏳ সরাসরি ডাউনলোড শুরু হচ্ছে...`,
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
