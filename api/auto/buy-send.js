// api/auto/buy-send.js
const core = require('../_engine');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }
  try {
    const { collectionId, recipient } = req.body || {};
    if (!collectionId) throw new Error('collectionId required');
    if (!recipient) throw new Error('recipient required ("@username" or numeric user_id")');

    const out = await core.autoBuyAndSend({ collectionId, recipient, payForUpgrade: true });
    res.status(200).json({ ok: true, result: out });
  } catch (e) {
    console.error('[auto/buy-send]', e);
    res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
};
