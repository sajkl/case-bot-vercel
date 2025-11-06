import crypto from 'crypto';

function dcsRaw(qs){
  const a = String(qs).split('&').filter(Boolean).filter(p=>!p.startsWith('hash='));
  a.sort((x,y)=>x.split('=')[0].localeCompare(y.split('=')[0]));
  return a.join('\n');
}
function dcsDecoded(qs){
  const sp = new URLSearchParams(qs);
  const entries = [];
  for (const [k,v] of sp) if (k !== 'hash') entries.push([k,v]);
  entries.sort((a,b)=>a[0].localeCompare(b[0]));
  return entries.map(([k,v]) => `${k}=${v}`).join('\n'); // уже декодировано
}
function hmac(str, token){
  const secret = crypto.createHash('sha256').update((token||'').trim()).digest();
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

export default async (req,res)=>{
  const { initData='', token='' } = req.method==='POST' ? (req.body||{}) : req.query;
  const provided = new URLSearchParams(initData).get('hash') || '';
  const raw = dcsRaw(initData);
  const dec = dcsDecoded(initData);
  const rawH = token ? hmac(raw, token) : null;
  const decH = token ? hmac(dec, token)  : null;
  res.status(200).json({
    provided: provided?.slice(0,16)+'…',
    raw_prefix: raw.slice(0,140), raw_hmac: rawH ? rawH.slice(0,16)+'…' : null,
    dec_prefix: dec.slice(0,140), dec_hmac: decH ? decH.slice(0,16)+'…' : null,
    equal_raw: provided && rawH ? provided===rawH : null,
    equal_dec: provided && decH ? provided===decH : null
  });
};
