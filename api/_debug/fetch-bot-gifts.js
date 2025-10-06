// api/_debug/fetch-bot-gifts.js
export default async function handler(req, res) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(400).json({ ok:false, error: 'No TELEGRAM_BOT_TOKEN' });
    const r = await fetch(`https://api.telegram.org/bot${token}/getAvailableGifts`);
    const j = await r.json();
    if (!j.ok) return res.status(502).json(j);
    const arr = j.result?.gifts || j.result?.items || j.result?.list || [];
    const first = arr[0] || {};
    const keys = Object.keys(first);
    res.json({
      ok: true,
      count: arr.length,
      keysOfFirstItem: keys,
      first5: arr.slice(0,5) // достаточно, чтобы понять схему
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e) });
  }
}
