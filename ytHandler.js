const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// আল্ট্রাফাস্ট ডিরেক্ট এপিআই দিয়ে ভিডিও ডাউনলোড লিংক আনা
async function getDirectVideoUrl(fullYtUrl) {
  // ১. প্রাথমিক ইঞ্জিন (VKR High Speed Engine)
  try {
    const vkrApiUrl = `https://vkrdownloader.org/server/?api_key=vkrdownloader&vkr=${encodeURIComponent(fullYtUrl)}`;
    const res = await fetch(vkrApiUrl);
    if (res.ok) {
      const data = await res.json();
      const formats = data.formats || data.data?.formats || [];
      
      // অডিও সহ সেরা কোয়ালিটির MP4 ভিডিও খোঁজা (1080p -> 720p -> বেস্ট)
      const best1080 = formats.find(f => (f.format_id === '1080p' || f.format_note?.includes('1080')) && f.url && f.ext === 'mp4');
      const best720 = formats.find(f => (f.format_id === '720p' || f.format_note?.includes('720')) && f.url && f.ext === 'mp4');
      const fallbackBest = formats.find(f => f.url && f.ext === 'mp4');

      const selected = best1080 || best720 || fallbackBest;
      if (selected && selected.url) {
        return { url: selected.url, title: data.title || 'YouTube Video' };
      }
    }
  } catch (e) {
    console.error('VKR Engine error:', e);
  }

  // ২. ব্যাকআপ ইঞ্জিন (Cobalt Cluster)
  const servers = ['https://cobalt.meowing.de', 'https://co.wuk.sh'];
  for (const s of servers) {
    try {
      const cRes = await fetch(`${s}/`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fullYtUrl, videoQuality: '1080', downloadMode: 'auto' })
      });
      if (cRes.ok) {
        const cData = await cRes.json();
        const dl = cData.url || (cData.picker && cData.picker[0]?.url);
        if (dl) return { url: dl, title: 'YouTube Video' };
      }
    } catch (e) {}
  }

  return null;
}

// সরাসরি টেলিগ্রাম বটে ভিডিও পাঠানোর মূল ফাংশন
async funct
