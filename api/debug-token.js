// /api/debug-token.js
// Показывает, какой BOT_TOKEN сейчас видит Vercel, и что отвечает getMe

module.exports = async function handler(req, res) {
  const raw = process.env.BOT_TOKEN || '';
  const token = raw.trim();

  if (!token) {
    return res.status(200).json({
      ok: false,
      reason: 'BOT_TOKEN env is empty on server'
    });
  }

  // Маскируем токен, чтобы не палить целиком
  const mask = token.slice(0, 6) + '…' + token.slice(-4);

  try {
    const url = `https://api.telegram.org/bot${token}/getMe`;
    const r = await fetch(url);
    const data = await r.json();

    return res.status(200).json({
      ok: true,
      token_mask: mask,
      getMe: data
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      token_mask: mask,
      error: String(e)
    });
  }
};
