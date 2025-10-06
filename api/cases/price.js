// api/cases/price.js
const engine = require('../_engine');

module.exports = async function handler(req, res) {
  try {
    await engine.refresh();
    const pricing = engine.getCasePricing();
    res.status(200).json(pricing);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};


