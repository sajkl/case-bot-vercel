const engine = require('../_engine');

module.exports = async (req, res) => {
  try {
    await engine.refresh();
    const d = engine.getDiagnostics();
    res.status(200).json({
      ok: true,
      ts: d.ts,
      sources: d.sources,
      counts: d.counts,
      sample: d.sample.market
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};

