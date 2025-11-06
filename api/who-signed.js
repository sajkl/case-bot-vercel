import crypto from 'crypto';

function computeFromRaw(raw, token) {
  const secret = crypto.createHash('sha256').update((token||'').trim()).digest();
  const parts = String(raw).split('&').filter(Boolean).filter(p=>!p.startsWith('hash='));
  parts.sort((a,b)=> a.split('=')[0].localeCompare(b.split('=')[0]));
  const dcs = parts.join('\n');
  return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
}
async function getMe(token){ try{
  const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const j = await r.json(); return j?.ok ? j.result : null;
} catch { return null; } }

export default async (req,res)=>{
  const body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
  const initData = body.initData || '';
  const provided = new URLSearchParams(initData).get('hash') || '';
  const TOKENS = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '')
    .split(',').map(s=>s.trim()).filter(Boolean);

  for (let i=0;i<TOKENS.length;i++){
    const t = TOKENS[i];
    if (computeFromRaw(initData, t) === provided){
      const me = await getMe(t);
      return res.status(200).json({ ok:true, index:i, bot: me?.username || null, bot_id: me?.id || null });
    }
  }
  res.status(200).json({ ok:false });
};

