// /api/bot.js
'use strict';

// ⚠️ Никаких ESM-экспортов. Только CommonJS.
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const WEBAPP_URL = 'https://case-bot-vercel.vercel.app/profile/';

async function sendMessage(chatId, text, replyMarkup) {
  if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is missing');
    return { ok: false, description: 'BOT_TOKEN missing' };
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, reply_markup: replyMarkup };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error('sendMessage error:', j);
  return j;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      // Удобный ping из браузера
      return res.status(200).json({ ok: true, hint: 'POST Telegram update JSON here' });
    }

    // На Vercel в Node runtime req.body уже объект; на всякий случай парсим строку.
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
        {
          inline_keyboard: [[
            { text: '🚀 Открыть Lambo Drop', web_app: { url: WEBAPP_URL } }
          ]]
        }
      );
    }

    // Всегда отдаём 200, чтобы TG не ретраил
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('bot webhook fatal:', e);
    // Даже при ошибке — 200, чтобы не копить pending_update_count
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
};
