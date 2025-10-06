// api/peek.js
const engine = require('./_engine');

module.exports = async function handler(req, res) {
  try {
    await engine.refresh();
    const limit = Number(req.query?.limit || 20);
    res.status(200).json({ ok: true, items: engine.peek(limit) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
