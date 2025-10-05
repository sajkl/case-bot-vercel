// api/gifts/stars.js
const core = require('../_engine');

module.exports = async (req, res) => {
  try {
    const by = await core.getStarsByCollection();
    res.status(200).json({ ok: true, byCollection: by });
  } catch (e) {
    console.error('[gifts/stars]', e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
};
