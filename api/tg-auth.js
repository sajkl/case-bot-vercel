// /api/tg-auth.js
// Надёжная проверка Telegram initData (raw) + поддержка нескольких токенов
import crypto from 'crypto';

function computeHmacFromRawInitData(rawInitData, botToken) {
  const secret = crypto.createHash('sha256').update((botToken || '').trim()).digest();

  // Разбираем СЫРОЙ querystring без декодирования,
  // удаляем hash=..., сортируем по ключу и склеиваем через \n
  const parts = String(rawInitData)
    .split('&')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => !p.startsWith('hash='))
    .sort((a, b) => {
      const ka = a.split('=')[0];
      const kb = b.split('=')[0];
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  const dataCheckString = parts.join('\n');
  return crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

function signJwt(payload, secret, expSec = 60 * 60 * 24 * 7) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expSec })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', (secret || '').trim()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method not allowed' });
  }

  // Читаем тело безопасно (Vercel может уже распарсить req.body)
  let initData = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    initData = body.initData || '';
  } catch {
    initData = (req.body && req.body.initData) || '';
  }

  const RAW_TOKENS =
    (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',').map(s => s.trim()).filter(Boolean);

  if (!initData)  return res.status(200).json({ ok: false, reason: 'missing initData' });
  if (!RAW_TOKENS.length) return res.status(200).json({ ok: false, reason: 'missing BOT_TOKEN(S) env' });

  const providedHash = new URLSearchParams(initData).get('hash') || '';
  if (!providedHash) return res.status(200).json({ ok: false, reason: 'missing hash' });

  // Перебираем все токены и ищем совпадение подписи
  let matchedToken = null;
  let matchedIndex = -1;
  let computedFirst = ''; // на случай отладки
  for (let i = 0; i < RAW_TOKENS.length; i++) {
    const tok = RAW_TOKENS[i];
    const comp = computeHmacFromRawInitData(initData, tok);
    if (!computedFirst) computedFirst = comp;
    if (comp === providedHash) {
      matchedToken = tok;
      matchedIndex = i;
      break;
    }
  }

  if (!matchedToken) {
    return res.status(200).json({
      ok: false,
      reason: 'bad hash',
      // короткая отладка — поможет, если что-то снова «поедет»
      debug: {
        provided: providedHash.slice(0, 16) + '…',
        sample_computed: computedFirst ? computedFirst.slice(0, 16) + '…' : null,
        tokens_count: RAW_TOKENS.length
      }
    });
  }

  // Достаём user из initData (это уже можно декодировать)
  let user = null;
  try {
    user = JSON.parse(new URLSearchParams(initData).get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user?.id) return res.status(200).json({ ok: false, reason: 'no user in initData' });

  // Секрет для подписи JWT
  const APP_SECRET = (process.env.APP_SECRET || (matchedToken + ':dev')).trim();
  const token = signJwt({ sub: String(user.id), tg: user }, APP_SECRET);

  // HttpOnly-кука (и возвращаем токен в теле на случай проблем с куками в WebView)
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`
  );

  return res.status(200).json({
    ok: true,
    token,                  // можно использовать как Bearer на клиенте
    matched_index: matchedIndex,  // какой из BOT_TOKENS совпал
    // mask: например, ****ZuN4 — удобно видеть, что реально матчится (не светим весь токен)
    matched_mask: matchedToken.slice(0, 6) + '…' + matchedToken.slice(-4)
  });
}
