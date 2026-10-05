const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Api } = require('telegram');

// ১. গুগল প্লে স্ক্র্যাপার সেফ লোডার
let gplay = null;
try {
  const gp = require('google-play-scraper');
  gplay = gp.search ? gp : (gp.default || gp);
} catch (e) {
  gplay = null;
}

// অ্যাপ সার্চ করার স্মার্ট ফাংশন
async function searchApp(term) {
  if (gplay && typeof gplay.search === 'function') {
    try {
      const results = await gplay.search({ term, num: 1 });
      if (results && results.length > 0) {
        return { appId: results[0].appId, title: results[0].title };
      }
    } catch (e) {}
  }

  try {
    const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(term)}&c=apps&hl=en`;
    const res = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    const match = res.data.match(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/);
    if (match) {
      return { appId: match[1], title: term };
    }
  } catch (err) {}

  return null;
}

// Aptoide থেকে ডিরেক্ট পিওর APK খোঁজা
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

async function handlePlayStoreDownload(client, chatId, inputQuery) {
  let statusMsg = null;
  let tempFilePath = null;

  try {
    statusMsg = await client.sendMessage(chatId, {
      message: '🔍 <b>প্লে স্টোরে অ্যাপ অনুসন্ধান করা হচ্ছে...</b>',
      parseMode: 'html'
    });

    let appId = '';
    let appTitle = '';
    let appVersion = 'Latest';

    const cleanInput = inputQuery.trim();

    const linkMatch = cleanInput.match(/id=([a-zA-Z0-9._]+)/);
    if (linkMatch) {
      appId = linkMatch[1];
    } else if (cleanInput.includes('.') && !cleanInput.includes(' ')) {
      appId = cleanInput;
    }

    if (!appId) {
      const found = await searchApp(cleanInput);
      if (!found) {
        if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
        await client.sendMessage(chatId, {
          message: '❌ <b>প্লে স্টোরে এই নামের কোনো অ্যাপ খুঁজে পাওয়া যায়নি!</b>',
          parseMode: 'html'
        });
        return;
      }
      appId = found.appId;
      appTitle = found.title;
    } else {
      appTitle = appId;
    }

    if (gplay && typeof gplay.app === 'function') {
      try {
        const details = await gplay.app({ appId });
        appTitle = details.title || appTitle;
        appVersion = details.version || 'Latest';
      } catch (e) {}
    }

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📦 <b>অ্যাপ:</b> ${appTitle}\n🆔 <code>${appId}</code>\n⏳ <b>অফিসিয়াল APK ডাউনলোড ও প্রসেসিং হচ্ছে...</b>`,
      parseMode: 'html'
    });

    // ১. প্রথমে ডিরেক্ট পিওর APK খোঁজা (Aptoide)
    let downloaded = false;
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

    // ২. যদি ডিরেক্ট APK না পায়, তবে APKPure সিডিএন থেকে আনা
    if (!downloaded) {
      const downloadConfigs = [
        { url: `https://d.apkpure.net/b/APK/${appId}?version=latest`, isXapk: false },
        { url: `https://d.apkpure.com/b/APK/${appId}?version=latest`, isXapk: false },
        { url: `https://d.apkpure.net/b/XAPK/${appId}?version=latest`, isXapk: true },
        { url: `https://d.apkpure.com/b/XAPK/${appId}?version=latest`, isXapk: true }
      ];

      for (const item of downloadConfigs) {
        const candidatePath = path.join(os.tmpdir(), `${appId}_${Date.now()}.${item.isXapk ? 'xapk' : 'apk'}`);
        try {
          const writer = fs.createWriteStream(candidatePath);
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

          if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).size > 1024 * 1024) {
            // যদি ফাইলটি XAPK হয়, তবে আনজিপ করে আসল .apk বের করা
            if (item.isXapk) {
              try {
                const zip = new AdmZip(candidatePath);
                const zipEntries = zip.getEntries();
                const mainApkEntry = zipEntries.find(e => e.entryName.endsWith('.apk') && !e.entryName.startsWith('config.'));

                if (mainApkEntry) {
                  const extractedApk = path.join(os.tmpdir(), `${appId}_clean_${Date.now()}.apk`);
                  fs.writeFileSync(extractedApk, mainApkEntry.getData());
                  fs.unlinkSync(candidatePath);
                  tempFilePath = extractedApk;
                  downloaded = true;
                  break;
                }
              } catch (zErr) {}
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
💾 <b>সাইজ:</b> ${fileSizeMB} MB
✅ <b>১-ক্লিক ইনস্টলেবল APK</b>
━━━━━━━━━━━━━━━━━━━━━━`;

    // ৩. টেলিগ্রামে সরাসরি প্যাকেজ ইনস্টলার ফরম্যাটে পাঠানো
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

module.exports = { handlePlayStoreDownload };
