// api/debug/snapshot.js
const { getDiagnostics } = require('../_engine');

module.exports = async (req, res) => {
  try {
    const data = await getDiagnostics();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify({ ok: true, ...data }));
  } catch (e) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  }
};

