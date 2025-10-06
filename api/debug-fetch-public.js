// api/debug-fetch-public.js
module.exports.config = { runtime: 'nodejs18.x' };

module.exports = async (req, res) => {
  const url = process.env.GIFTS_SOURCE_URL || 'https://tg.me/gifts/available_gifts';
  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify({
      ok: true,
      from: url,
      status: r.status,
      keys: json && typeof json==='object' ? Object.keys(json) : null,
      sample: Array.isArray(json) ? json.slice(0, 5)
             : json?.data?.gifts?.slice?.(0, 5)
             : json?.gifts?.slice?.(0, 5)
             : json?.items?.slice?.(0, 5)
             : json?.available_gifts?.slice?.(0, 5)
             : json?.list?.slice?.(0, 5)
             : json?.results?.slice?.(0, 5)
             : (json ? [json] : []),
    }));
  } catch (e) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify({ ok:false, error: e?.message || String(e) }));
  }
};
