// api/auto/buy-send.js
module.exports.config = { runtime: 'nodejs18.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let engine;
  try { engine = require('../_engine'); } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:'require _engine failed', detail:String(e) })); return;
  }

  try {
    // ожидаем query ?giftId=...&to=username
    const url = new URL(req.url, `http://${req.headers.host}`);
    const giftId = url.searchParams.get('giftId');
    const to = url.searchParams.get('to');
    if (!giftId || !to) {
      res.status(200).end(JSON.stringify({ ok:false, error:'giftId and to are required' }));
      return;
    }

    // здесь должна быть реальная покупка через официальный API (пока заглушка)
    const result = await engine.autoBuyAndSend?.(giftId, to);
    res.status(200).end(JSON.stringify({ ok:true, result: result || { mock:true } }));
  } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:String(e), stack:e?.stack || null }));
  }
};

