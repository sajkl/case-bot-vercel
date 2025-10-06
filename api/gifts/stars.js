const engine = require('../_engine');
module.exports.config = { runtime: 'nodejs20.x' };

module.exports = async (req, res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    await engine.refresh();
    // поддержка нового и старого интерфейса
    if (engine.getStarsByCollectionAll) {
      res.status(200).end(JSON.stringify(engine.getStarsByCollectionAll()));
    } else {
      res.status(200).end(JSON.stringify({ catalogByCollection: engine.getStarsByCollection() }));
    }
  } catch (e) {
    res.status(200).end(JSON.stringify({ ok:false, error:String(e) }));
  }
};
