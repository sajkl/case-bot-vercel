// api/peek.js
module.exports.config = { runtime: 'nodejs18.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let engine;
  try {
    engine = require('./_engine');
  } catch (e) {
    res.status(200).end(JSON.stringify({
      ok: false,
      error: 'Failed to require _engine',
      detail: e?.message || String(e),
      stack: e?.stack || null
    }));
    return;
  }

  const { getPeek } = engine || {};
  if (typeof getPeek !== 'function') {
    res.status(200).end(JSON.stringify({
      ok: false,
      error: 'getPeek is not a function',
      exportedKeys: Object.keys(engine || {})
    }));
    return;
  }

  let limit = 10;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const l = Number(url.searchParams.get('limit'));
    if (Number.isFinite(l) && l > 0) limit = Math.min(50, Math.max(1, l));
  } catch (_) {}

  try {
    const items = await getPeek(limit);
    res.status(200).end(JSON.stringify({ ok: true, items }));
  } catch (e) {
    res.status(200).end(JSON.stringify({
      ok: false,
      error: e?.message || String(e),
      stack: e?.stack || null
    }));
  }
};

