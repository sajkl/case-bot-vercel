const engine = require('../_engine');

module.exports = async function handler(req, res) {
  try {
    await engine.refresh();
    res.status(200).json(engine.getStarsByCollection());
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
