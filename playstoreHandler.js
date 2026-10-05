const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { pipeline } = require('stream/promises');
const { Api } = require('telegram');

const fastAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 30,
  maxFreeSockets: 10
});

let gplay = null;
try {
  const gp = require('google-play-scraper');
  gplay = gp.search ? gp : (gp.default || gp);
} catch (e) {
  gplay = null;
}

// লিঙ্ক থেকে একদম নিখুঁত প্যাকেজ আইডি বের করার ক্লিনার
function extractCleanPackageId(input) {
  const clean = input.trim();
  // id=com.xxx.yyy থেকে শুধুমাত্র প্যাকেজ অংশটুকু আলাদা করা
  const match = clean.match(/[?&]id=([a-zA-Z0-9._]+)/);
  if (match) return match[1];

  const plainMatch = clean.match(/^([a-zA-Z0-9._]+)$/);
  if (plainMatch && plainMatch[1].includes('.')) return plainMatch[1];

  return null;
}

// দ্রুততম সার্চ
async function searchPlayStoreFast(query) {
  const cleanQ = query.trim();

  if (gplay && typeof gplay.search === 'function') {
    try {
      const results = await gplay.search({ term: cleanQ, num: 1, country: 'us', lang: 'en' });
      if (results && results.length > 0) return { appId: results[0].appId, title: results[0].title };
    } catch (e) {}

    try {
      const results2 = await gplay.search({ term: cleanQ, num: 1, country: 'bd', lang: 'bn' });
      if (results2 && results2.length > 0) return { appId: results2[0].appId, title: results2[0].title };
    } catch (e) {}
  }

  try {
    const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(cleanQ)}&c=apps`;
    const res = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 4000,
      httpsAgent: fastAgent
    });
    const match = res.data.match(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/);
    if (match) return { appId: match[1], title: cleanQ };
  } catch (err) {}

  return null;
}

// Aptoide ব্যাকআপ
async function getAptoideDownload(packageId) {
  try {
    const res = await axios.get(`https://ws75.aptoide.com/api/7/apps/search?query=${packageId}&limit=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 6000,
      httpsAgent: fastAgent
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

// কোর ডাউনলোডার ইঞ্জিন
async function executeApkDownload(client, chatId, appId) {
  let statusMsg = null;
  let tempFilePath = null;

  try {
    statusMsg = await client.sendMessage(chatId, {
      message: '⚡ <b>প্লে স্টোর থেকে ফাইল প্রস্তুত হচ্ছে...</b>',
      parseMode: 'html'
    });

    let appTitle = appId;
    let appVersion = 'Latest';
    let lastUpdated = 'আজকেই আপডেট করা';

    const metadataTask = (async () => {
      if (gplay && typeof gplay.app === 'function') {
        try {
          const details = await gplay.app({ appId });
          if (details.title) appTitle = details.title;
          if (details.version && details.version !== 'Varies with device') appVersion = details.version;
          if (details.updated) {
            const d = new Date(details.updated);
            if (!isNaN(d.getTime())) {
              lastUpdated = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
          }
        } catch (e) {}
      }
    })();

    const timestamp = Date.now();
    // ⚡ মাল্টি-সিডিএন লিংক (XAPK ও সাধারণ APK উভয়ই সক্রিয়)
    const downloadConfigs = [
      { url: `https://d.apkpure.net/b/XAPK/${appId}?version=latest&t=${timestamp}`, isXapk: true },
      { url: `https://d.apkpure.net/b/APK/${appId}?version=latest&t=${timestamp}`, isXapk: false },
      { url: `https://d.apkpure.com/b/XAPK/${appId}?version=latest&t=${timestamp}`, isXapk: true },
      { url: `https://d.apkpure.com/b/APK/${appId}?version=latest&t=${timestamp}`, isXapk: false }
    ];

    let downloaded = false;

    for (const item of downloadConfigs) {
      const candidatePath = path.join(os.tmpdir(), `${appId}_${timestamp}.${item.isXapk ? 'xapk' : 'apk'}`);
      try {
        const response = await axios({
          method: 'GET',
          url: item.url,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://apkpure.com/'
          },
          timeout: 20000,
          maxRedirects: 8,
          httpsAgent: fastAgent
        });

        if ((response.headers['content-type'] || '').includes('text/html')) {
          continue;
        }

        const writer = fs.createWriteStream(candidatePath);
        await pipeline(response.data, writer);

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
                const targetDir = os.tmpdir();
                zip.extractEntryTo(mainApk, targetDir, false, true);
                const extractedFile = path.join(targetDir, mainApk.entryName);
                
                try { fs.unlinkSync(candidatePath); } catch (e) {}
                tempFilePath = extractedFile;
                downloaded = true;
                break;
              }
            } catch (err) {}
          }
          tempFilePath = candidatePath;
          downloaded = true;
          break;
        } else {
          try { fs.unlinkSync(candidatePath); } catch (e) {}
        }
      } catch (err) {
        try { if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath); } catch (e) {}
      }
    }

    if (!downloaded) {
      const aptoideApp = await getAptoideDownload(appId);
      if (aptoideApp && aptoideApp.url) {
        const candidatePath = path.join(os.tmpdir(), `${appId}_${Date.now()}.apk`);
        try {
          const response = await axios({
            method: 'GET',
            url: aptoideApp.url,
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 20000,
            httpsAgent: fastAgent
          });

          const writer = fs.createWriteStream(candidatePath);
          await pipeline(response.data, writer);

          if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).size > 1024 * 1024) {
            tempFilePath = candidatePath;
            downloaded = true;
            if (aptoideApp.version) appVersion = aptoideApp.version;
          }
        } catch (e) {
          try { if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath); } catch (err) {}
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

    await metadataTask;

    const fileSizeMB = (fs.statSync(tempFilePath).size / (1024 * 1024)).toFixed(2);
    const cleanFileName = `${appTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'App'}.apk`;

    const caption = 
`📱 <b>${appTitle}</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>প্যাকেজ:</b> <code>${appId}</code>
📦 <b>ভার্সন:</b> ${appVersion}
🗓 <b>লাস্ট আপডেট:</b> ${lastUpdated}
💾 <b>সাইজ:</b> ${fileSizeMB} MB
✅ <b>১-ক্লিক ইনস্টলেবল APK (All Devices Compatible)</b>
━━━━━━━━━━━━━━━━━━━━━━`;

    // ⚡ ৬-থ্রেড অপ্টিমাইজড টার্বো আপলোড
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: caption,
      parseMode: 'html',
      forceDocument: true,
      mimeType: 'application/vnd.android.package-archive',
      attributes: [
        new Api.DocumentAttributeFilename({ fileName: cleanFileName })
      ],
      workers: 6
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
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
}

// মেইন হ্যান্ডলার
async function handlePlayStoreDownload(client, chatId, inputQuery) {
  const pkgId = extractCleanPackageId(inputQuery);
  if (pkgId) {
    return await executeApkDownload(client, chatId, pkgId);
  }

  const found = await searchPlayStoreFast(inputQuery);
  if (!found || !found.appId) {
    await client.sendMessage(chatId, {
      message: '❌ <b>প্লে স্টোরে এই নামের কোনো অ্যাপ খুঁজে পাওয়া যায়নি!</b>',
      parseMode: 'html'
    });
    return;
  }

  return await executeApkDownload(client, chatId, found.appId);
}

async function handlePhotoSearch(client, message) {
  await message.reply({ 
    message: '💡 <b>অনুগ্রহ করে অ্যাপের নাম (বাংলা বা ইংরেজি) অথবা প্লে স্টোরের লিংক লিখে পাঠান।</b>' 
  });
}

module.exports = { handlePlayStoreDownload, executeApkDownload, handlePhotoSearch };
