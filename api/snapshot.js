const engine = require('./_engine');
module.exports.config = { runtime: 'nodejs20.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    await engine.refresh();
    const d = engine.getDiagnostics();
    res.status(200).end(JSON.stringify(d));
  } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:String(e), exportedKeys:Object.keys(engine) }));
  }
};

