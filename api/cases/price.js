// api/cases/price.js
module.exports.config = { runtime: 'nodejs18.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let engine;
  try { engine = require('../_engine'); } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:'require _engine failed', detail:String(e) })); return;
  }

  try {
    const out = await engine.getCasePricing(); // твоя функция, собирающая 4 кейса
    res.status(200).end(JSON.stringify({ ok:true, result: out }));
  } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:String(e), stack:e?.stack || null }));
  }
};


