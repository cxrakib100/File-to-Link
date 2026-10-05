const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

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

  // সরাসরি প্লে স্টোর ওয়েব থেকে ব্যাকআপ সার্চ
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

// Aptoide API ব্যাকআপ ইঞ্জিন (সরাসরি আনরেস্ট্রিক্টেড সিডিএন)
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
          version: match.file.vername || 'Latest',
          filesize: match.file.filesize
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

    // ১. লিংক থেকে Package ID বের করা
    const linkMatch = cleanInput.match(/id=([a-zA-Z0-9._]+)/);
    if (linkMatch) {
      appId = linkMatch[1];
    } else if (cleanInput.includes('.') && !cleanInput.includes(' ')) {
      appId = cleanInput;
    }

    // ২. নাম বা লিংক অনুযায়ী অ্যাপ চিহ্নিত করা
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
      text: `📦 <b>অ্যাপ:</b> ${appTitle}\n🆔 <code>${appId}</code>\n⏳ <b>লেটেস্ট ফাইল ডাউনলোড করা হচ্ছে...</b>`,
      parseMode: 'html'
    });

    // ৩. ইঞ্জিন ১: APKPure CDN ট্রাই করা
    const downloadConfigs = [
      { url: `https://d.apkpure.net/b/XAPK/${appId}?version=latest`, ext: 'xapk' },
      { url: `https://d.apkpure.net/b/APK/${appId}?version=latest`, ext: 'apk' },
      { url: `https://d.apkpure.com/b/XAPK/${appId}?version=latest`, ext: 'xapk' },
      { url: `https://d.apkpure.com/b/APK/${appId}?version=latest`, ext: 'apk' }
    ];

    let downloaded = false;
    let finalExt = 'apk';

    for (const item of downloadConfigs) {
      const candidatePath = path.join(os.tmpdir(), `${appId}_${Date.now()}.${item.ext}`);
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
          timeout: 45000,
          maxRedirects: 10
        });

        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
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
          tempFilePath = candidatePath;
          finalExt = item.ext;
          downloaded = true;
          break;
        } else {
          if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
        }
      } catch (err) {
        if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
      }
    }

    // ৪. ইঞ্জিন ২ (ব্যাকআপ): যদি ইঞ্জিন ১-এ না পায়, Aptoide থেকে চেষ্টা করা
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
            finalExt = 'apk';
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
        message: '⚠️ <b>ডাউনলোড ব্যর্থ হয়েছে!</b> অ্যাপটি কোনো আন্তর্জাতিক সিডিএন-এ পাওয়া যায়নি (পেইড অথবা রিজিয়ন রেস্ট্রিক্টেড হতে পারে)।',
        parseMode: 'html'
      });
      return;
    }

    const fileSizeMB = (fs.statSync(tempFilePath).size / (1024 * 1024)).toFixed(2);

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📤 <b>ডাউনলোড সম্পন্ন!</b> (${fileSizeMB} MB)\n🚀 <b>টেলিগ্রামে ফাইল পাঠানো হচ্ছে...</b>`,
      parseMode: 'html'
    });

    const isXapk = finalExt === 'xapk';
    const caption = 
`📱 <b>${appTitle}</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>প্যাকেজ:</b> <code>${appId}</code>
📦 <b>ভার্সন:</b> ${appVersion}
💾 <b>সাইজ:</b> ${fileSizeMB} MB
📁 <b>ফরম্যাট:</b> ${isXapk ? 'XAPK (Split APK)' : 'APK'}
✅ <b>অফিসিয়াল লেটেস্ট ভার্সন</b>
${isXapk ? '💡 <i>(টিপস: এটি স্প্লিট অ্যাপ, ইনস্টল করতে "XAPK Installer" বা "SAI" অ্যাপ ব্যবহার করুন)</i>' : ''}
━━━━━━━━━━━━━━━━━━━━━━`;

    // ৫. টেলিগ্রামে ফাইল পাঠানো
    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: caption,
      parseMode: 'html',
      forceDocument: true,
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
