// api/ping.js
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).end(JSON.stringify({ ok: true, pong: true, path: req.url }));
};
