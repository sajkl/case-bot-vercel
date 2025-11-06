import { validate } from '@telegram-apps/init-data-node';
import crypto from 'crypto';

function signJwt(payload, secret, expSec = 60*60*24*7){
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body   = Buffer.from(JSON.stringify({...payload, exp:Math.floor(Date.now()/1000)+expSec})).toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export default async function handler(req,res){
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ ok:false }); }
  const body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
  const initData = body.initData || '';

  // 1) Валидируем подпись платформы (Ed25519). Никаких токенов не нужно.
  const ok = await validate(initData, { signature: true }).catch(()=>false);
  if (!ok) return res.status(200).json({ ok:false, reason:'bad signature' });

  // 2) Достаём user
  let user = null;
  try { user = JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch {}
  if (!user?.id) return res.status(200).json({ ok:false, reason:'no user' });

  // 3) Выпускаем JWT
  const APP_SECRET = (process.env.APP_SECRET || 'dev-secret').trim();
  const token = signJwt({ sub:String(user.id), tg:user }, APP_SECRET);

  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60*60*24*7}`);
  res.status(200).json({ ok:true, token });
}

