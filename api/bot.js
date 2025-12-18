// /api/bot.js
'use strict';

// --- Подключаем БД ---
let db = null;
try {
  db = require('../db');
  console.log('[bot] db module loaded');
} catch (e) {
  console.warn('[bot] db module NOT loaded. Transactions will FAIL properly.', e.message);
}

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
// Ссылка на твой Web App (замени, если поменяется домен)
const WEBAPP_URL = 'https://case-bot-vercel.vercel.app/profile/';

// --- Утилита для запросов к Telegram ---
async function tg(method, payload) {
  if (!BOT_TOKEN) {
    console.error('[tg] BOT_TOKEN is empty');
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
      console.error('[tg] API error', method, j);
    }
    return j;
  } catch (e) {
    console.error('[tg] fetch error', method, e);
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

// --- ЛОГИКА НАЧИСЛЕНИЯ ЗВЁЗД (Самое важное) ---
async function handleStarTransaction(tx) {
  const userId = tx.user_id;
  
  // Telegram иногда присылает amount, иногда total_amount
  const starsSpent = tx.stars || tx.amount || tx.total_amount || 0;

  if (!userId || starsSpent <= 0) {
    console.warn('[stars] Invalid tx data:', tx);
    return;
  }

  console.log(`[stars] Processing tx for User ${userId}, Amount: ${starsSpent}`);

  if (!db) {
    console.error('[stars] DB not connected! Cannot save transaction.');
    return;
  }

  try {
    await db.query('BEGIN');

    // 1. ГАРАНТИЯ: Создаем юзера, если его нет (чтобы не упал Foreign Key)
    // Даже если мы не знаем username, нам нужен хотя бы ID в таблице users
    await db.query(`
      INSERT INTO users (telegram_id) VALUES ($1)
      ON CONFLICT (telegram_id) DO NOTHING
    `, [userId]);

    // 2. ОБНОВЛЕНИЕ БАЛАНСА (Upsert)
    // Сразу прибавляем и возвращаем новое значение
    const res = await db.query(`
      INSERT INTO balances (user_id, stars)
      VALUES ($1, $2)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        stars = balances.stars + $2,
        updated_at = NOW()
      RETURNING stars
    `, [userId, starsSpent]);

    const newBalance = res.rows[0].stars;
    const oldBalance = newBalance - starsSpent;

    // 3. ЗАПИСЬ В ИСТОРИЮ
    await db.query(`
      INSERT INTO balance_tx (user_id, type, amount, balance_before, balance_after, meta)
      VALUES ($1, 'topup_stars', $2, $3, $4, $5)
    `, [userId, starsSpent, oldBalance, newBalance, JSON.stringify(tx)]);

    await db.query('COMMIT');
    console.log(`[stars] SUCCESS! User ${userId} +${starsSpent}★. New Balance: ${newBalance}`);
    
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('[stars] Transaction FAILED:', e);
  }
}

// --- ОСНОВНОЙ ОБРАБОТЧИК WEBHOOK ---
module.exports = async function handler(req, res) {
  try {
    // GET запрос для проверки статуса
    if (req.method === 'GET') {
      const masked = BOT_TOKEN
        ? BOT_TOKEN.slice(0, 6) + '…' + BOT_TOKEN.slice(-4)
        : '(empty)';
      return res.status(200).json({
        ok: true,
        status: 'Bot is running',
        db_connected: !!db,
        token_mask: masked
      });
    }

    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true, hint: 'Send POST with Telegram update' });
    }

    let update = req.body;
    // Парсинг на случай, если пришла строка
    if (typeof update === 'string') {
      try { update = JSON.parse(update); } catch { update = {}; }
    }
    update = update || {};

    // Логируем только важные события, чтобы не засорять логи
    if (update.message || update.pre_checkout_query || update.purchased_paid_media) {
      console.log('[bot] Update:', JSON.stringify(update).slice(0, 200) + '...');
    }

    const msg = update.message || update.edited_message || null;

    // 1) /start
    if (msg?.text?.startsWith('/start')) {
      await sendMessage(msg.chat.id, 'Привет! Открой приложение, чтобы испытать удачу 👇', {
        inline_keyboard: [[{ text: '🚀 Открыть Lambo Drop', web_app: { url: WEBAPP_URL } }]]
      });
    }

    // 2) PRE_CHECKOUT_QUERY (Критично для оплаты!)
    // Telegram спрашивает: "Можно провести оплату?" Мы отвечаем: "Да" (ok: true)
    if (update.pre_checkout_query) {
      await tg('answerPreCheckoutQuery', {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true
      });
    }

    // 3) SUCCESSFUL_PAYMENT (Инвойсы)
    if (msg && msg.successful_payment) {
      const pay = msg.successful_payment;
      await handleStarTransaction({
        user_id: msg.from.id,
        total_amount: pay.total_amount,
        payload: pay.invoice_payload,
        raw: pay
      });
      // Можно отправить подтверждение
      await sendMessage(msg.chat.id, `✅ Оплата принята! +${pay.total_amount} звезд.`);
    }

    // 4) Обычные Stars транзакции (если приходят отдельно)
    if (update.stars_transaction) {
      const tx = update.stars_transaction;
      await handleStarTransaction({
        user_id: tx.from.id, // ВАЖНО: проверить структуру update, id может быть в user
        amount: tx.amount,
        raw: tx
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[bot] Fatal error:', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
};
