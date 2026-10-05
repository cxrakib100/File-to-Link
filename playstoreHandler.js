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

// অ্যাপ সার্চ করার বুলেটপ্রুফ ফাংশন (লাইব্রেরি ফেইল করলেও ব্যাকআপ সার্চ করবে)
async function searchApp(term) {
  if (gplay && typeof gplay.search === 'function') {
    try {
      const results = await gplay.search({ term, num: 1 });
      if (results && results.length > 0) {
        return { appId: results[0].appId, title: results[0].title };
      }
    } catch (e) {}
  }

  // সরাসরি প্লে স্টোর থেকে সার্চ রেজাল্ট বের করার বিকল্প সিস্টেম
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

    // ১. লিংক থেকে Package ID খোঁজা
    const linkMatch = cleanInput.match(/id=([a-zA-Z0-9._]+)/);
    if (linkMatch) {
      appId = linkMatch[1];
    } else if (cleanInput.includes('.') && !cleanInput.includes(' ')) {
      appId = cleanInput;
    }

    // ২. নাম বা লিংক প্রসেসিং
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

    // অ্যাপ ডিটেইলস সংগ্রহ
    if (gplay && typeof gplay.app === 'function') {
      try {
        const details = await gplay.app({ appId });
        appTitle = details.title || appTitle;
        appVersion = details.version || 'Latest';
      } catch (e) {}
    }

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📦 <b>অ্যাপ:</b> ${appTitle}\n🆔 <code>${appId}</code>\n⏳ <b>প্লে স্টোর থেকে লেটেস্ট ফাইল ডাউনলোড হচ্ছে...</b>`,
      parseMode: 'html'
    });

    // ৩. সাধারণ APK ও স্প্লিট XAPK উভয় ফরম্যাটের লিংক
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          },
          timeout: 60000,
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
        if (stats.size > 1024 * 1024) { // ১ মেগাবাইটের বেশি ফাইল নিশ্চিত করা
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

    if (!downloaded || !fs.existsSync(tempFilePath)) {
      if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      await client.sendMessage(chatId, {
        message: '⚠️ <b>ডাউনলোড ব্যর্থ হয়েছে!</b> অ্যাপটি পেইড অথবা প্লে স্টোর থেকে রিমুভ করা হয়েছে।',
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
${isXapk ? '💡 <i>(টিপস: এটি স্প্লিট অ্যাপ, ফোনে ইনস্টল করতে "XAPK Installer" বা "SAI" অ্যাপ ব্যবহার করুন)</i>' : ''}
━━━━━━━━━━━━━━━━━━━━━━`;

    // ৪. টেলিগ্রামে আল্ট্রা-ফাস্ট আপলোড
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
