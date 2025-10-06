// api/_debug/fetch-bot-gifts.js
module.exports = async function handler(req, res) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    if (!token) return res.status(400).json({ ok: false, error: 'No TELEGRAM_BOT_TOKEN/BOT_TOKEN' });

    const r = await fetch(`https://api.telegram.org/bot${token}/getAvailableGifts`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) return res.status(502).json(j);

    const arr = j.result?.gifts || j.result?.items || j.result?.list || [];
    const first = arr[0] || {};
    const keys = Object.keys(first);
    res.status(200).json({
      ok: true,
      count: Array.isArray(arr) ? arr.length : 0,
      keysOfFirstItem: keys,
      first5: Array.isArray(arr) ? arr.slice(0, 5) : [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
