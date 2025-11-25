// api/create-stars-invoice.js
// Создание инвойса в Telegram Stars через createInvoiceLink

const crypto = require('crypto');

function computeHmacFromRawInitData(rawInitData, botToken) {
  const secret = crypto.createHash('sha256').update(botToken).digest();

  const pairs = String(rawInitData).split('&')
    .map(s => s.trim())
    .filter(Boolean);

  const withoutHash = pairs.filter(p => !p.startsWith('hash='));

  withoutHash.sort((a, b) => {
    const ka = a.split('=')[0];
    const kb = b.split('=')[0];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const dataCheckString = withoutHash.join('\n');

  return crypto.createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method not allowed' });
  }

  const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
  if (!BOT_TOKEN) {
    return res.status(200).json({ ok: false, reason: 'BOT_TOKEN env is empty' });
  }

  const { initData, amount } = req.body || {};
  if (!initData) {
    return res.status(200).json({ ok: false, reason: 'missing initData' });
  }

  const starCount = Number(amount) || 0;
  if (!Number.isInteger(starCount) || starCount <= 0) {
    return res.status(200).json({ ok: false, reason: 'bad amount' });
  }

  // Проверяем подпись initData
  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');
  if (!providedHash) {
    return res.status(200).json({ ok: false, reason: 'missing hash' });
  }

  const computedHash = computeHmacFromRawInitData(initData, BOT_TOKEN);
  if (computedHash !== providedHash) {
    return res.status(200).json({
      ok: false,
      reason: 'bad hash',
      debug: {
        provided: providedHash.slice(0, 16) + '…',
        computed: computedHash.slice(0, 16) + '…'
      }
    });
  }

  // Достаём user из initData
  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch (e) {
    user = null;
  }
  if (!user || !user.id) {
    return res.status(200).json({ ok: false, reason: 'no user in initData' });
  }

  const payload = `stars:${user.id}:${Date.now()}`;

  // Создаём ссылку на инвойс в Stars (currency: XTR, provider_token = пустая строка)
  const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`;

  const body = {
    title: 'Покупка звёзд',
    description: 'Пополнение баланса LamboLuck',
    payload,
    currency: 'XTR',
    prices: [
      {
        label: 'Звёзды',
        amount: starCount // количество звёзд
      }
    ],
    provider_token: '' // для Stars должен быть пустой
  };

  try {
    const tgRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await tgRes.json();

    if (!data.ok) {
      return res.status(200).json({
        ok: false,
        reason: 'telegram api error',
        tg: { error_code: data.error_code, description: data.description }
      });
    }

    const invoiceLink = data.result; // строка-ссылка
    return res.status(200).json({ ok: true, link: invoiceLink });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      reason: 'fetch failed',
      error: String(e)
    });
  }
};
