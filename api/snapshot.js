const engine = require('./_engine');

module.exports = async function handler(req, res) {
  try {
    await engine.refresh(); // важно: актуализируем состояние
    const snap = engine.getDiagnostics(); // совместимо с вашим старым кодом
    res.status(200).json(snap);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e), exportedKeys: Object.keys(engine) });
  }
};


