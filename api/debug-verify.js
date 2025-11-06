import crypto from 'crypto';
function parse(qs){const p=new URLSearchParams(qs);const o={};for(const [k,v] of p)o[k]=v;return o}
function dcs(obj){return Object.entries(obj).filter(([k])=>k!=='hash')
  .sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')}
export default function handler(req,res){
  const BOT_TOKEN=(process.env.BOT_TOKEN||'').trim();
  const {initData=''}=req.method==='POST'?(req.body||{}):req.query;
  const obj=parse(initData); const provided=obj.hash||null;
  let computed=null, reason=null;
  try{
    if(!BOT_TOKEN) reason='missing BOT_TOKEN';
    else if(!provided) reason='missing hash';
    else{
      const secret=crypto.createHash('sha256').update(BOT_TOKEN).digest();
      computed=crypto.createHmac('sha256',secret).update(dcs(obj)).digest('hex');
      if(computed!==provided) reason='bad hash';
    }
  }catch{reason='exception'}
  res.status(200).json({
    ok: reason===null, reason, have_user: !!obj.user,
    provided_hash: provided?.slice(0,16)+'…', computed_hash: computed?.slice(0,16)+'…',
    sample_keys: Object.keys(obj).slice(0,8)
  });
}
