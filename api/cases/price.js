// api/cases/price.js
const core = require('../_engine');

module.exports = async (req, res) => {
  try {
    const data = await core.getCasePricing();
    res.status(200).json({ ok: true, result: data });
  } catch (e) {
    console.error('[cases/price]', e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
};

