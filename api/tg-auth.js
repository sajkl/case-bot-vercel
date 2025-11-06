// ВЕРСИЯ ПРОВЕРКИ БЕЗ ДЕКОДИРОВАНИЯ
import crypto from 'crypto';

function computeHmacFromRawInitData(rawInitData, botToken) {
  const secret = crypto.createHash('sha256').update(botToken).digest();

  // 1) разбираем сырые пары key=value, не декодируя значения
  const pairs = String(rawInitData).split('&')
    .map(s => s.trim())
    .filter(Boolean);

  // 2) выкидываем hash=...
  const withoutHash = pairs.filter(p => !p.startsWith('hash='));

  // 3) сортируем по ключу (до знака '='), без декодирования
  withoutHash.sort((a, b) => {
    const ka = a.split('=')[0];
    const kb = b.split('=')[0];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // 4) собираем data_check_string ровно как «key=value» построчно
  const dataCheckString = withoutHash.join('\n');

  // 5) HMAC
  return crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason: 'method not allowed' });

  const BOT_TOKEN  = (process.env.BOT_TOKEN || '').trim();
  const APP_SECRET = (process.env.APP_SECRET || (BOT_TOKEN + ':dev')).trim();
  const { initData } = req.body || {};

  if (!initData)  return res.status(200).json({ ok:false, reason:'missing initData' });
  if (!BOT_TOKEN) return res.status(200).json({ ok:false, reason:'missing BOT_TOKEN env' });

  // берём hash из сырой строки сами (тоже без декода)
  const providedHash = new URLSearchParams(initData).get('hash');
  if (!providedHash) return res.status(200).json({ ok:false, reason:'missing hash' });

  const computedHash = computeHmacFromRawInitData(initData, BOT_TOKEN);
  if (computedHash !== providedHash) {
    return res.status(200).json({
      ok:false, reason:'bad hash',
      debug: { provided: providedHash.slice(0,16)+'…', computed: computedHash.slice(0,16)+'…' }
    });
  }

  // user берём уже из распарсенных параметров (здесь можно декодировать)
  let user = null;
  try { user = JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch {}
  if (!user?.id) return res.status(200).json({ ok:false, reason:'no user in initData' });

  // выпускаем JWT и ставим куку
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body   = Buffer.from(JSON.stringify({ sub:String(user.id), tg:user, exp:Math.floor(Date.now()/1000)+60*60*24*7 })).toString('base64url');
  const sig    = crypto.createHmac('sha256', APP_SECRET).update(`${header}.${body}`).digest('base64url');
  const token  = `${header}.${body}.${sig}`;

  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60*60*24*7}`);
  res.status(200).json({ ok:true, token });
}

