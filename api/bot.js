// /api/bot.js
'use strict';

const db = require('../db');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const WEBAPP_URL = 'https://case-bot-vercel.vercel.app/profile/';

// --- минимальный клиент Bot API ---
async function tg(method, payload) {
  if (!BOT_TOKEN) {
    console.error('tg(): BOT_TOKEN is empty');
    return { ok: false, description: 'BOT_TOKEN empty' };
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) {
      console.error('TG API error:', method, payload, j);
    }
    return j;
  } catch (e) {
    console.error('TG API fetch error:', method, e);
    return { ok: false, description: String(e.message || e) };
  }
}

async function sendMessage(chatId, text, replyMarkup) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup
  });
}

// --- логика начисления звёзд в БД ---
async function handleStarTransaction(tx) {
  // tx: наша обёртка вокруг successful_payment / stars_transaction

  const userId = tx.user_id;
  if (!userId) {
    console.warn('star tx without userId', tx);
    return;
  }

  // Пытаемся аккуратно определить кол-во звёзд
  // Для обычного invoice: total_amount (в минимальных единицах), currency = 'XTR'
  // Для stars_transaction может быть поле amount / stars — подправим после просмотра логов
  const starsSpent =
    tx.stars ??
    tx.amount ??
    tx.total_amount ??
    0;

  if (!starsSpent || starsSpent <= 0) {
    console.warn('star tx has no stars amount', tx);
    return;
  }

  const addStars = starsSpent; // 1 Star = 1 ★ (можешь поменять курс)

  try {
    await db.query('BEGIN');

    const curRes = await db.query(
      `SELECT stars FROM balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const current = curRes.rows[0] ? Number(curRes.rows[0].stars) : 0;
    const next = current + addStars;

    await db.query(
      `INSERT INTO balances (user_id, stars)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         stars = EXCLUDED.stars,
         updated_at = now()`,
      [userId, next]
    );

    await db.query(
      `INSERT INTO balance_tx (user_id, type, amount, balance_before, balance_after, meta)
       VALUES ($1, 'topup_stars', $2, $3, $4, $5)`,
      [userId, addStars, current, next, JSON.stringify(tx)]
    );

    await db.query('COMMIT');
    console.log('star topup ok', { userId, addStars, current, next });
  } catch (e) {
    console.error('star tx db error:', e);
    await db.query('ROLLBACK').catch(() => {});
  }
}

module.exports = async function handler(req, res) {
  try {
    // --- GET для быстрой проверки токена из браузера ---
    if (req.method === 'GET') {
      const masked = BOT_TOKEN
        ? BOT_TOKEN.slice(0, 6) + '…' + BOT_TOKEN.slice(-4)
        : '(empty)';
      return res.status(200).json({ ok: true, token_mask: masked });
    }

    if (req.method !== 'POST') {
      return res
        .status(200)
        .json({ ok: true, hint: 'POST Telegram update JSON here' });
    }

    let update = req.body;
    if (typeof update === 'string') {
      try {
        update = JSON.parse(update || '{}');
      } catch {
        update = {};
      }
    }
    update = update || {};

    console.log('TG UPDATE:', JSON.stringify(update, null, 2));

    const msg = update.message || update.edited_message || null;

    // 1) /start → шлём кнопку с WebApp
    if (
      msg?.chat?.type === 'private' &&
      typeof msg.text === 'string' &&
      msg.text.trim().startsWith('/start')
    ) {
      await sendMessage(msg.chat.id, 'Открой мини-апп 👇', {
        inline_keyboard: [
          [
            {
              text: '🚀 Открыть Lambo Drop',
              web_app: { url: WEBAPP_URL }
            }
          ]
        ]
      });
    }

    // 2) pre_checkout_query (ОБЯЗАТЕЛЬНО ответить, иначе таймаут покупки)
    if (update.pre_checkout_query) {
      await tg('answerPreCheckoutQuery', {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true
      });
    }

    // 3) successful_payment (обычный invoice, в том числе Stars через invoice)
    if (msg && msg.successful_payment) {
      const pay = msg.successful_payment;
      console.log('SUCCESSFUL PAYMENT:', pay);

      await handleStarTransaction({
        user_id: msg.from && msg.from.id,
        total_amount: pay.total_amount,
        currency: pay.currency,
        payload: pay.invoice_payload,
        raw: pay
      });

      await sendMessage(
        msg.chat.id,
        'Оплата прошла успешно ✅ Звёзды зачислены на баланс в приложении.'
      );
    }

    // 4) stars_transaction (если Телеграм шлёт отдельный тип апдейта для Stars)
    if (update.stars_transaction) {
      const tx = update.stars_transaction;
      console.log('STARS TRANSACTION:', tx);

      await handleStarTransaction({
        user_id: tx.from && tx.from.id,
        amount: tx.amount,
        raw: tx
      });

      if (tx.from?.id) {
        await sendMessage(
          tx.from.id,
          `⭐ Успешная звёздная транзакция на ${tx.amount} звёзд. Баланс обновлён.`
        );
      }
    }

    // 5) message.star_transaction (если внезапно приходит так)
    if (msg && msg.star_transaction) {
      const tx = msg.star_transaction;
      console.log('MESSAGE.STAR_TRANSACTION:', tx);

      await handleStarTransaction({
        user_id: msg.from && msg.from.id,
        amount: tx.amount,
        raw: tx
      });
    }

    // ВСЕГДА отвечаем 200 быстро
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('bot webhook fatal:', e);
    return res
      .status(200)
      .json({ ok: false, error: String(e?.message || e) });
  }
};
