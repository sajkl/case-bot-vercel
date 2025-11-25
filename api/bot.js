// /api/bot.js
'use strict';

const db = require('../db');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const WEBAPP_URL = 'https://case-bot-vercel.vercel.app/profile/';

// Минималка для вызова Bot API
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
  if (!BOT_TOKEN) return { ok:false, description:'BOT_TOKEN missing' };
  const j = await tg('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
  if (!j.ok) console.error('sendMessage error:', j);
  return j;
}

// Логика начисления звёзд за Star-операцию
async function handleStarTransaction(tx) {
  // tx — объект star_transaction или successful_payment
  // Для звезд Telegram шлёт star_transaction в поле message.star_transaction,
  // но формат чуть меняется — надо будет посмотреть конкретный payload, который придёт в логах.

  const userId = tx.user_id || (tx.from && tx.from.id);
  if (!userId) {
    console.warn('star tx without userId', tx);
    return;
  }

  // Сколько Stars пришло:
  const starsSpent = tx.stars || tx.amount || 0; // тут придётся поправить по реальному полю
  if (!starsSpent || starsSpent <= 0) {
    console.warn('star tx has no stars amount', tx);
    return;
  }

  // Твой курс: 1 Star = 1 ★ (или другой, как хочешь)
  const addStars = starsSpent;

  // Обновляем баланс и пишем историю
  const client = await db.query('BEGIN').then(() => db).catch(() => null);
  try {
    const curRes = await db.query(
      `SELECT stars FROM balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const current = curRes.rows[0] ? Number(curRes.rows[0].stars) : 0;
    const next = current + addStars;

    await db.query(
      `INSERT INTO balances (user_id, stars)
       VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET
         stars = EXCLUDED.stars,
         updated_at = now()`,
      [userId, next]
    );

    await db.query(
      `INSERT INTO balance_tx (user_id, type, amount, balance_before, balance_after, meta)
       VALUES ($1, 'topup_stars', $2, $3, $4, $5)`,
      [userId, addStars, current, next, tx]
    );

    await db.query('COMMIT');
    console.log('star topup ok', { userId, addStars, current, next });
  } catch (e) {
    console.error('star tx db error:', e);
    await db.query('ROLLBACK').catch(()=>{});
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const masked = BOT_TOKEN ? BOT_TOKEN.slice(0,6)+'…'+BOT_TOKEN.slice(-4) : '(empty)';
      return res.status(200).json({ ok:true, token_mask: masked });
    }

    if (req.method !== 'POST') {
      return res.status(200).json({ ok:true, hint:'POST Telegram update JSON here' });
    }

    let update = req.body;
    if (typeof update === 'string') {
      try { update = JSON.parse(update || '{}'); } catch { update = {}; }
    }
    update = update || {};

    const msg = update.message || update.edited_message || null;

    // 1) /start → шлём кнопку WebApp
    if (msg?.chat?.type === 'private' && typeof msg.text === 'string' && msg.text.trim().startsWith('/start')) {
      await sendMessage(
        msg.chat.id,
        'Открой мини-апп 👇',
        { inline_keyboard: [[ { text:'🚀 Открыть Lambo Drop', web_app:{ url: WEBAPP_URL } } ]] }
      );
    }

    // 2) Star-транзакции (надо будет поймать реальную структуру update)
    if (msg && msg.star_transaction) {
      await handleStarTransaction({
        ...msg.star_transaction,
        user_id: msg.from && msg.from.id
      });
    }

    // (для обычных платежей ещё могут прилетать message.successful_payment,
    // но для Stars основной кейс — star_transaction)

    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error('bot webhook fatal:', e);
    return res.status(200).json({ ok:false, error:String(e?.message||e) });
  }
};
