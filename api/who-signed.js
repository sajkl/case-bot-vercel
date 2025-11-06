import crypto from 'crypto';

function compute(raw, token) {
  const secret = crypto.createHash('sha256').update(token).digest();
  const parts = String(raw).split('&').filter(Boolean).filter(p=>!p.startsWith('hash='));
  parts.sort((a,b)=> a.split('=')[0].localeCompare(b.split('=')[0]));
  const dcs = parts.join('\n');
  return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
}

async function getMe(token){
  try{
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json();
    return j?.ok ? j.result : null;
  }catch{return null;}
}

export default async (req,res)=>{
  const { initData='' } = req.method==='POST' ? (req.body||{}) : req.query;
  const provided = new URLSearchParams(initData).get('hash') || '';
  const TOKENS = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '')
    .split(',').map(s=>s.trim()).filter(Boolean);

  const checks = [];
  for(const t of TOKENS){
    const comp = compute(initData, t);
    const match = provided && comp && provided===comp;
    const me = match ? await getMe(t) : null;
    checks.push({ match, bot: me ? me.username : null, bot_id: me ? me.id : null });
    if(match) break;
  }
  res.status(200).json({ ok: checks.some(c=>c.match), checks });
}
