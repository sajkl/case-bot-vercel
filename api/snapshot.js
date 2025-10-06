// api/snapshot.js
// ЯВНО указываем Node.js runtime (не Edge), чтобы работал CommonJS/require
module.exports.config = { runtime: 'nodejs18.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let engine;
  try {
    // важно: относительный путь к api/_engine.js
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

  const { getDiagnostics } = engine || {};
  if (typeof getDiagnostics !== 'function') {
    res.status(200).end(JSON.stringify({
      ok: false,
      error: 'getDiagnostics is not a function',
      exportedKeys: Object.keys(engine || {})
    }));
    return;
  }

  try {
    const data = await getDiagnostics();
    res.status(200).end(JSON.stringify({ ok: true, ...data }));
  } catch (e) {
    res.status(200).end(JSON.stringify({
      ok: false,
      error: e?.message || String(e),
      stack: e?.stack || null
    }));
  }
};


