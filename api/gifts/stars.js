// api/gifts/stars.js
module.exports.config = { runtime: 'nodejs18.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let engine;
  try { engine = require('../_engine'); } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:'require _engine failed', detail:String(e) })); return;
  }

  try {
    const byCollection = await engine.getStarsByCollection(); // { [collectionId]: [ {giftId, stars, ...}, ... ] }
    res.status(200).end(JSON.stringify({ ok:true, byCollection }));
  } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:String(e), stack:e?.stack || null }));
  }
};

