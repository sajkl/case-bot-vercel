const engine = require('../_engine');
module.exports.config = { runtime: 'nodejs20.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    await engine.refresh();
    if (engine.getCasePricingAll) {
      res.status(200).end(JSON.stringify(engine.getCasePricingAll()));
    } else {
      res.status(200).end(JSON.stringify({ ok:true, catalog: engine.getCasePricing() }));
    }
  } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:String(e) }));
  }
};
