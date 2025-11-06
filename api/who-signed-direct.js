// /api/who-signed-direct.js
import crypto from 'crypto';

function computeFromRaw(raw, token) {
  const key = crypto.createHash('sha256').update((token||'').trim()).digest();
  const parts = String(raw).split('&').filter(Boolean).filter(p=>!p.startsWith('hash='))
    .sort((a,b)=> a.split('=')[0].localeCompare(b.split('=')[0]));
  const dcs = parts.join('\n');
  return crypto.createHmac('sha256', key).update(dcs).digest('hex');
}

export default async function handler(req, res) {
  const body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
  const initData = body.initData || '';
  const token = (body.token || '').trim();
  if (!initData || !token) return res.status(200).json({ ok:false, reason:'missing initData or token' });

  const provided = new URLSearchParams(initData).get('hash') || '';
  const computed = computeFromRaw(initData, token);
  res.status(200).json({
    ok: !!provided && provided === computed,
    provided: provided ? provided.slice(0,16)+'…' : null,
    computed: computed ? computed.slice(0,16)+'…' : null
  });
}
