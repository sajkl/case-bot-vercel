// api/snapshot.js
const engine = require('./_engine');

module.exports = async function handler(req, res) {
  try {
    // гарантируем, что состояние свежее
    await engine.refresh();
    const snap = engine.getDiagnostics(); // совместимо с твоей старой ручкой
    res.status(200).json(snap);
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e),
      exportedKeys: Object.keys(engine),
    });
  }
};


