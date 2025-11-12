// /api/bot.js (CommonJS)
'use strict';

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const WEBAPP_URL = 'https://case-bot-vercel.vercel.app/profile/';

async function tg(method, payload) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload || {})
  });
  return r.json().catch(() => ({}));
}

async function sendMessage(chatId, text, replyMarkup) {
  if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is missing');
    return { ok: false, description: 'BOT_TOKEN missing' };
  }
  const j = await tg('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
  if (!j.ok) console.error('sendMessage error:', j);
  return j;
}

module.exports = async function handler(req, res) {
  try {
    // GET: отладка (покажет, какой токен видит функция, и результат getMe)
    if (req.method === 'GET') {
      const masked = BOT_TOKEN ? (BOT_TOKEN.slice(0,6) + '…' + BOT_TOKEN.slice(-4)) : '(empty)';
      const me = BOT_TOKEN ? await tg('getMe') : { ok:false, reason:'no token' };
      return res.status(200).json({ ok:true, token_mask: masked, getMe: me });
    }

    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true, hint: 'POST Telegram update JSON here' });
    }

    let update = req.body;
    if (typeof update === 'string') {
      try { update = JSON.parse(update || '{}'); } catch { update = {}; }
    }
    update = update || {};

    const msg = update.message || update.edited_message || null;

    // /start в личке → шлём кнопку WebApp
    if (
      msg &&
      msg.chat &&
      msg.chat.type === 'private' &&
      typeof msg.text === 'string' &&
      msg.text.trim().startsWith('/start')
    ) {
      await sendMessage(
        msg.chat.id,
        'Открой мини-апп 👇',
        { inline_keyboard: [[ { text: '🚀 Открыть Lambo Drop', web_app: { url: WEBAPP_URL } } ]] }
      );
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('bot webhook fatal:', e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
