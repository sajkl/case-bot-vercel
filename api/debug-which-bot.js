import crypto from 'crypto';

function compute(raw, token) {
  const secret = crypto.createHash('sha256').update((token || '').trim()).digest();
  const pairs = String(raw).split('&').filter(Boolean).filter(p => !p.startsWith('hash='));
  pairs.sort((a,b)=> (a.split('=')[0] < b.split('=')[0] ? -1 : 1));
  const dcs = pairs.join('\n');
  return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
}

async function getMe(token) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json();
    return j?.ok ? j.result : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  const { initData = '' } = req.method === 'POST' ? (req.body || {}) : req.query;
  const provided = new URLSearchParams(initData).get('hash') || '';

  const candidates = [
    ['BOT_TOKEN', process.env.BOT_TOKEN],
    ['TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN],
    ['LEGACY_TOKEN', process.env.TELEGRAM_TOKEN],
  ].filter(([,v]) => v);

  const checks = [];
  for (const [name, token] of candidates) {
    const computed = compute(initData, token);
    const match = computed === provided;
    const me = match ? await getMe(token) : null;
    checks.push({ name, match, computed: computed.slice(0,16)+'…', me: me ? { id: me.id, username: me.username } : null });
  }

  res.status(200).json({
    provided: provided.slice(0,16)+'…',
    matches: checks.filter(x => x.match),
    checks
  });
}
