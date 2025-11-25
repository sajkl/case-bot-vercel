// api/create-stars-invoice.js
// Создание инвойса Telegram Stars по уже существующей сессии (кука sid)

const crypto = require('crypto');

function verifyJwtFromCookie(cookieHeader, secret) {
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!match) return null;

  const token = match[1];
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;

  const data = `${headerB64}.${bodyB64}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  if (expectedSig !== sigB64) return null;

  let payload;
  try {
    const json = Buffer.from(bodyB64, 'base64url').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    return null;
  }

  if (payload.exp && Date.now() / 1000 > payload.exp) return null;

  return payload; // { sub, tg, exp, ... }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method not allowed' });
  }

  const BOT_TOKEN  = (process.env.BOT_TOKEN  || '').trim();
  const APP_SECRET = (process.env.APP_SECRET || '').trim();

  if (!BOT_TOKEN) {
    return res.status(200).json({ ok:false, reason:'BOT_TOKEN env is empty' });
  }
  if (!APP_SECRET) {
    return res.status(200).json({ ok:false, reason:'APP_SECRET env is empty' });
  }

  // 1) Читаем JWT из куки sid
  const jwt = verifyJwtFromCookie(req.headers.cookie || '', APP_SECRET);
  if (!jwt || !jwt.sub) {
    return res.status(200).json({ ok:false, reason:'no session' });
  }

  const userId = String(jwt.sub);
  const tgUser = jwt.tg || null;

  // 2) Количество звёзд из тела запроса
  let amount = 0;
  try {
    amount = Number(req.body?.amount);
  } catch {
    amount = 0;
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(200).json({ ok:false, reason:'bad amount' });
  }

  const payload = `stars:${userId}:${Date.now()}`;

  // 3) Вызов createInvoiceLink для Stars
  const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`;

  const body = {
    title: 'Покупка звёзд',
    description: 'Пополнение звёзд для LamboLuck',
    payload,
    currency: 'XTR',                 // Telegram Stars
    prices: [
      { label: 'Stars', amount }     // amount = количество звёзд
    ]
    // provider_token не указываем для Stars
  };

  try {
    const tgRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await tgRes.json();

    if (!data.ok) {
      // Прокидываем ошибку наружу для дебага
      return res.status(200).json({
        ok: false,
        reason: 'telegram api error',
        tg: {
          error_code: data.error_code,
          description: data.description
        },
        debug: {
          currency: body.currency,
          amount: body.prices[0].amount
        }
      });
    }

    const invoiceLink = data.result;
    return res.status(200).json({
      ok: true,
      link: invoiceLink,
      user: { id: userId, username: tgUser?.username || null }
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      reason: 'fetch failed',
      error: String(e)
    });
  }
};
