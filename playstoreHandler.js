const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Api } = require('telegram');

let gplay = null;
try {
  const gp = require('google-play-scraper');
  gplay = gp.search ? gp : (gp.default || gp);
} catch (e) {
  gplay = null;
}

// বাংলা ও ইংরেজি আল্ট্রা-ফাস্ট প্লে স্টোর সার্চ
async function searchPlayStoreFast(query) {
  const cleanQ = query.trim();

  if (gplay && typeof gplay.search === 'function') {
    try {
      const results = await gplay.search({ term: cleanQ, num: 2, country: 'bd', lang: 'bn' });
      if (results && results.length > 0) {
        return { appId: results[0].appId, title: results[0].title };
      }
    } catch (e) {}

    try {
      const results2 = await gplay.search({ term: cleanQ, num: 2, country: 'us', lang: 'en' });
      if (results2 && results2.length > 0) {
        return { appId: results2[0].appId, title: results2[0].title };
      }
    } catch (e) {}
  }

  try {
    const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(cleanQ)}&c=apps`;
    const res = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    const match = res.data.match(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/);
    if (match) {
      return { appId: match[1], title: cleanQ };
    }
  } catch (err) {}

  return null;
}

// Aptoide ব্যাকআপ সিডিএন ইঞ্জিন
async function getAptoideDownload(packageId) {
  try {
    const res = await axios.get(`https://ws75.aptoide.com/api/7/apps/search?query=${packageId}&limit=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
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

// কোর ডাউনলোডার ইঞ্জিন (র‍্যাম প্রটেকশন ও নো-হ্যাং অপ্টিমাইজেশন)
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
            timeout: 50000
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

    // ⚡ ৪-থ্রেড অপ্টিমাইজড আপলোড (যা মেমোরি হ্যাং হওয়া প্রতিরোধ করে)
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
    // ⚡ প্রসেস শেষে মেমোরি তৎক্ষণাৎ ক্লিয়ার
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
}

// মেইন প্লে স্টোর হ্যান্ডলার
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

  const found = await searchPlayStoreFast(cleanInput);

  if (!found || !found.appId) {
    await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
    await client.sendMessage(chatId, {
      message: '❌ <b>প্লে স্টোরে এই নামের কোনো অ্যাপ খুঁজে পাওয়া যায়নি!</b>',
      parseMode: 'html'
    });
    return;
  }

  await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
  return await executeApkDownload(client, chatId, found.appId);
}

module.exports = { handlePlayStoreDownload, executeApkDownload };
