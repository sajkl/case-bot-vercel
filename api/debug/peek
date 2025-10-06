// api/debug/peek.js
const { getPeek } = require('../_engine');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 10));
    const items = await getPeek(limit);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify({ ok: true, items }));
  } catch (e) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  }
};
