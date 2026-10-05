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

// প্লে স্টোর লাইভ সার্চ ও ডিটেইলস
async function getLivePlayStoreDetails(input) {
  let appId = '';
  let appTitle = '';
  let appVersion = 'Latest';
  let lastUpdated = 'আজকেই আপডেট করা';

  const clean = input.trim();
  const linkMatch = clean.match(/id=([a-zA-Z0-9._]+)/);
  if (linkMatch) {
    appId = linkMatch[1];
  } else if (clean.includes('.') && !clean.includes(' ')) {
    appId = clean;
  }

  // নাম দিয়ে সার্চ
  if (!appId) {
    if (gplay && typeof gplay.search === 'function') {
      try {
        const results = await gplay.search({ term: clean, num: 1 });
        if (results && results.length > 0) {
          appId = results[0].appId;
          appTitle = results[0].title;
        }
      } catch (e) {}
    }

    if (!appId) {
      try {
        const res = await axios.get(`https://play.google.com/store/search?q=${encodeURIComponent(clean)}&c=apps&hl=en`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const match = res.data.match(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/);
        if (match) appId = match[1];
      } catch (e) {}
    }
  }

  // প্লে স্টোরের লাইভ ডাটা ও রিলিজ ডেট সংগ্রহ
  if (appId && gplay && typeof gplay.app === 'function') {
    try {
      const details = await gplay.app({ appId });
      appTitle = details.title || appTitle || appId;
      if (details.version && details.version !== 'Varies with device') {
        appVersion = details.version;
      }
      if (details.updated) {
        const d = new Date(details.updated);
        if (!isNaN(d.getTime())) {
          lastUpdated = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }
    } catch (e) {
      if (!appTitle) appTitle = appId;
    }
  }

  return { appId, appTitle: appTitle || appId, appVersion, lastUpdated };
}

async function handlePlayStoreDownload(client, chatId, inputQuery) {
  let statusMsg = null;
  let tempFilePath = null;

  try {
    statusMsg = await client.sendMessage(chatId, {
      message: '🔍 <b>প্লে স্টোরে লাইভ আপডেট অনুসন্ধান করা হচ্ছে...</b>',
      parseMode: 'html'
    });

    // ১. প্লে স্টোর থেকে সরাসরি রিয়েল-টাইম তথ্য নেওয়া
    const { appId, appTitle, appVersion, lastUpdated } = await getLivePlayStoreDetails(inputQuery);

    if (!appId) {
      if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      await client.sendMessage(chatId, {
        message: '❌ <b>প্লে স্টোরে এই নামের কোনো অ্যাপ খুঁজে পাওয়া যায়নি!</b>',
        parseMode: 'html'
      });
      return;
    }

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📦 <b>অ্যাপ:</b> ${appTitle}\n🆔 <code>${appId}</code>\n⏳ <b>প্লে স্টোরের রিয়েল লেটেস্ট APK ডাউনলোড হচ্ছে...</b>`,
      parseMode: 'html'
    });

    // ২. লাইভ সিডিএন থেকে ফাইল নামানো (সবসময় একদম লেটেস্ট ক্যাশ-ফ্রি ভার্সন)
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
          // XAPK হলে আনজিপ করে আসল .apk বের করা
          if (item.isXapk) {
            try {
              const zip = new AdmZip(candidatePath);
              const zipEntries = zip.getEntries();
              const mainApkEntry = zipEntries.find(e => 
                e.entryName.toLowerCase().endsWith('.apk') && 
                !e.entryName.toLowerCase().startsWith('config.')
              ) || zipEntries.find(e => e.entryName.toLowerCase().endsWith('.apk'));

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

    // ৩. এক লাইনে সুসজ্জিত ক্যাপশন (Clean Single-Line Layout)
    const caption = 
`📱 <b>${appTitle}</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>প্যাকেজ:</b> <code>${appId}</code>
📦 <b>ভার্সন:</b> ${appVersion}
🗓 <b>লাস্ট আপডেট:</b> ${lastUpdated}
💾 <b>সাইজ:</b> ${fileSizeMB} MB
✅ <b>১-ক্লিক ইনস্টলেবল APK</b>
━━━━━━━━━━━━━━━━━━━━━━`;

    // ৪. টেলিগ্রামে অফিসিয়াল প্যাকেজ ইনস্টলার হিসেবে পাঠানো
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
