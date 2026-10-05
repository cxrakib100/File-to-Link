const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const axios = require('axios');
const gplay = require('google-play-scraper');

/**
 * গুগল প্লে স্টোরের লেটেস্ট APK আল্ট্রা-ফাস্ট ডাউনলোড ও সেন্ড হ্যান্ডলার
 */
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
    let appIcon = '';
    let appVersion = 'Latest';

    const cleanInput = inputQuery.trim();

    // ১. লিংক থেকে Package ID খোঁজা
    const linkMatch = cleanInput.match(/id=([a-zA-Z0-9._]+)/);
    if (linkMatch) {
      appId = linkMatch[1];
    } else if (cleanInput.includes('.') && !cleanInput.includes(' ')) {
      appId = cleanInput;
    }

    // ২. অ্যাপের তথ্য সংগ্রহ (প্লে স্টোর স্ক্র্যাপার)
    if (appId) {
      try {
        const details = await gplay.app({ appId });
        appTitle = details.title || appId;
        appIcon = details.icon || '';
        appVersion = details.version || 'Latest';
      } catch (e) {
        appTitle = appId;
      }
    } else {
      // নাম দিয়ে সার্চ করা
      const searchResults = await gplay.search({ term: cleanInput, num: 1 });
      if (!searchResults || searchResults.length === 0) {
        if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
        await client.sendMessage(chatId, {
          message: '❌ <b>দুঃখিত! প্লে স্টোরে এই নামের কোনো অ্যাপ খুঁজে পাওয়া যায়নি।</b>',
          parseMode: 'html'
        });
        return;
      }
      appId = searchResults[0].appId;
      appTitle = searchResults[0].title;
      appIcon = searchResults[0].icon || '';
      appVersion = searchResults[0].version || 'Latest';
    }

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `📦 <b>অ্যাপ:</b> ${appTitle}\n🆔 <code>${appId}</code>\n⏳ <b>প্লে স্টোর থেকে লেটেস্ট APK ডাউনলোড হচ্ছে...</b>`,
      parseMode: 'html'
    });

    // ৩. হাই-স্পিড অফিসিয়াল সিডিএন থেকে ফাইল স্ট্রিম করা
    const downloadUrls = [
      `https://d.apkpure.net/b/APK/${appId}?version=latest`,
      `https://d.apkpure.com/b/APK/${appId}?version=latest`
    ];

    tempFilePath = path.join(os.tmpdir(), `${appId}_${Date.now()}.apk`);
    let downloaded = false;

    for (const dlUrl of downloadUrls) {
      try {
        const writer = fs.createWriteStream(tempFilePath);
        const response = await axios({
          method: 'GET',
          url: dlUrl,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          },
          timeout: 45000
        });

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        const stats = fs.statSync(tempFilePath);
        if (stats.size > 1024 * 1024) { // ১ মেগাবাইটের বেশি সাইজ নিশ্চিত করা
          downloaded = true;
          break;
        }
      } catch (err) {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      }
    }

    if (!downloaded || !fs.existsSync(tempFilePath)) {
      if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      await client.sendMessage(chatId, {
        message: '⚠️ <b>ডাউনলোড ব্যর্থ হয়েছে!</b> অ্যাপটি পেইড (Paid) অথবা স্প্লিট ফরম্যাটে থাকার কারণে নামানো সম্ভব হয়নি।',
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

    // ৪. টেলিগ্রামে আল্ট্রা-ফাস্ট প্যারালাল আপলোড
    const caption = 
`📱 <b>${appTitle}</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>প্যাকেজ:</b> <code>${appId}</code>
📦 <b>ভার্সন:</b> ${appVersion}
💾 <b>সাইজ:</b> ${fileSizeMB} MB
✅ <b>অফিসিয়াল লেটেস্ট ভার্সন</b>
━━━━━━━━━━━━━━━━━━━━━━`;

    await client.sendFile(chatId, {
      file: tempFilePath,
      caption: caption,
      parseMode: 'html',
      forceDocument: true,
      workers: 4 // আল্ট্রা ফাস্ট মাল্টি-থ্রেডেড আপলোড
    });

    // কাজ শেষে স্ট্যাটাস মেসেজ এবং টেম্প ফাইল ক্লিনআপ
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
