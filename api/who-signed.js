// /api/who-signed.js (замени текущий)
import crypto from 'crypto';

function compute(raw, tok){
  const key = crypto.createHash('sha256').update((tok||'').trim()).digest();
  const parts = String(raw).split('&').filter(Boolean).filter(p=>!p.startsWith('hash='))
    .sort((a,b)=> a.split('=')[0].localeCompare(b.split('=')[0]));
  const dcs = parts.join('\n');
  return crypto.createHmac('sha256', key).update(dcs).digest('hex');
}
async function getMe(tok){
  try{ const r=await fetch(`https://api.telegram.org/bot${tok}/getMe`);
       const j=await r.json(); return j?.ok ? j.result : null; }catch{return null}
}

export default async (req,res)=>{
  const body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
  const initData = body.initData || '';
  const provided = new URLSearchParams(initData).get('hash') || '';
  const TOKENS = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '')
    .split(',').map(s=>s.trim()).filter(Boolean);

  const checks = [];
  for (let i=0;i<TOKENS.length;i++){
    const tok = TOKENS[i];
    const comp = compute(initData, tok);
    const match = !!provided && comp===provided;
    const me = match ? await getMe(tok) : null;
    checks.push({ i, token_mask: tok.slice(0,6)+'…'+tok.slice(-4), match, bot: me?.username||null });
    if (match) return res.status(200).json({ ok:true, i, bot: me?.username||null, checks });
  }
  res.status(200).json({ ok:false, provided: provided.slice(0,16)+'…', checks });
};
