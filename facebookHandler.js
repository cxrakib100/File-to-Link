const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { Api } = require('telegram');

// 🎨 লাইভ প্রোগ্রেস বার জেনারেটর
function createProgressBar(percent) {
  const totalBars = 10;
  const filledBars = Math.min(totalBars, Math.max(0, Math.round((percent / 100) * totalBars)));
  const emptyBars = totalBars - filledBars;
  return '█'.repeat(filledBars) + '░'.repeat(emptyBars);
}

async function handleFacebookDownload(client, chatId, videoUrl) {
  let statusMsg = null;
  let tempVideoPath = null;

  try {
    statusMsg = await client.sendMessage(chatId, {
      message: 
`⚡ <b>ভিডিও প্রসেসিং শুরু হচ্ছে...</b>
━━━━━━━━━━━━━━━━━━━━━━
📊 <b>অগ্রগতি:</b> <code>[░░░░░░░░░░] 0%</code>
⏳ <i>দয়া করে একটু অপেক্ষা করুন...</i>
━━━━━━━━━━━━━━━━━━━━━━`,
      parseMode: 'html'
    });

    // ১. ফেসবুক ভিডিও ডিরেক্ট লিংক রেজলভার এপিআই
    const apiUrl = `https://api.vkrdown.com/api/get?url=${encodeURIComponent(videoUrl)}`;
    const response = await axios.get(apiUrl, { timeout: 20000 });

    let downloadUrl = '';
    if (response.data && response.data.data) {
      const d = response.data.data;
      downloadUrl = d.hd || d.sd || (d.downloads && d.downloads[0]?.url) || '';
    }

    // ব্যাকআপ রেজলভার
    if (!downloadUrl) {
      const fbBackup = await axios.get(`https://fbdown.net/download.php?url=${encodeURIComponent(videoUrl)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      }).catch(() => null);

      if (fbBackup && fbBackup.data) {
        const hdMatch = fbBackup.data.match(/href="([^"]+)" id="hd"/i);
        const sdMatch = fbBackup.data.match(/href="([^"]+)" id="sd"/i);
        downloadUrl = hdMatch ? hdMatch[1] : (sdMatch ? sdMatch[1] : '');
      }
    }

    if (!downloadUrl) {
      if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });
      await client.sendMessage(chatId, {
        message: '❌ <b>ভিডিওটি ডাউনলোড করা যায়নি! এটি প্রাইভেট বা লিংকটি মেয়াদোত্তীর্ণ হতে পারে।</b>',
        parseMode: 'html'
      });
      return;
    }

    // ২. প্রোগ্রেস বার সহ ভিডিও ডাউনলোড
    tempVideoPath = path.join(os.tmpdir(), `fb_${Date.now()}.mp4`);
    const writer = fs.createWriteStream(tempVideoPath);

    const videoStream = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 60000
    });

    const totalLength = parseInt(videoStream.headers['content-length'] || '0', 10);
    let downloadedLength = 0;
    let lastEditTime = 0;

    videoStream.data.on('data', async (chunk) => {
      downloadedLength += chunk.length;
      if (totalLength > 0 && statusMsg) {
        const now = Date.now();
        // টেলিগ্রাম রেট লিমিট এড়াতে প্রতি ২ সেকেন্ডে আপডেট হবে
        if (now - lastEditTime > 2500) {
          lastEditTime = now;
          const percent = Math.min(99, Math.round((downloadedLength / totalLength) * 100));
          const currentMB = (downloadedLength / (1024 * 1024)).toFixed(1);
          const totalMB = (totalLength / (1024 * 1024)).toFixed(1);
          const bar = createProgressBar(percent);

          try {
            await client.editMessage(chatId, {
              message: statusMsg.id,
              text: 
`🎬 <b>ভিডিও ডাউনলোড হচ্ছে...</b>
━━━━━━━━━━━━━━━━━━━━━━
📊 <b>অগ্রগতি:</b> <code>[${bar}] ${percent}%</code>
💾 <b>সাইজ:</b> ${currentMB} MB / ${totalMB} MB
🚀 <i>সুপার ফাস্ট স্পিডে কাজ চলছে...</i>
━━━━━━━━━━━━━━━━━━━━━━`,
              parseMode: 'html'
            });
          } catch (e) {}
        }
      }
    });

    videoStream.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // ৩. ১০০% সম্পন্ন স্ট্যাটাস
    if (statusMsg) {
      try {
        await client.editMessage(chatId, {
          message: statusMsg.id,
          text: 
`✅ <b>ভিডিও প্রস্তুত সম্পন্ন! (১০০%)</b>
━━━━━━━━━━━━━━━━━━━━━━
📊 <code>[██████████] 100%</code>
📤 <i>টেলিগ্রামে পাঠানো হচ্ছে...</i>
━━━━━━━━━━━━━━━━━━━━━━`,
          parseMode: 'html'
        });
      } catch (e) {}
    }

    const caption = 
`🎬 <b>Facebook Video Downloaded</b>
━━━━━━━━━━━━━━━━━━━━━━
✨ <b>কোয়ালিটি:</b> High Quality
⚡ <b>স্পিড:</b> Ultra Super Fast
━━━━━━━━━━━━━━━━━━━━━━`;

    // ৪. টেলিগ্রামে ভিডিও আপলোড
    await client.sendFile(chatId, {
      file: tempVideoPath,
      caption: caption,
      parseMode: 'html',
      supportsStreaming: true,
      workers: 6
    });

    if (statusMsg) await client.deleteMessages(chatId, [statusMsg.id], { revoke: true });

  } catch (error) {
    if (statusMsg) {
      try { await client.deleteMessages(chatId, [statusMsg.id], { revoke: true }); } catch (e) {}
    }
    await client.sendMessage(chatId, {
      message: `❌ <b>ত্রুটি:</b> ভিডিওটি প্রসেস করা সম্ভব হয়নি।`,
      parseMode: 'html'
    });
  } finally {
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try { fs.unlinkSync(tempVideoPath); } catch (e) {}
    }
  }
}

module.exports = { handleFacebookDownload };
