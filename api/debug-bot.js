// /api/debug-bot.js
export default async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN || '';
  const who = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then(r=>r.json()).catch(()=>null);
  res.status(200).json({
    ok: !!(who && who.ok),
    bot_username: who?.result?.username || null,
    bot_id: who?.result?.id || null,
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
  });
}
