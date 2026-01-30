'use strict';

const crypto = require('crypto');

// --- НАСТРОЙКИ ---
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const WEBAPP_URL = 'https://case-bot-vercel.vercel.app/'; // Твоя ссылка
// КОШЕЛЕК ДЛЯ TON (Вставь свой!)
const MY_WALLET_ADDRESS = 'UQDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; 
const TON_API_URL = `https://toncenter.com/api/v2/getTransactions?address=${MY_WALLET_ADDRESS}&limit=20&to_lt=0&archival=false`;

// --- Подключение БД ---
let db = null;
try {
  db = require('../db');
  console.log('[bot] db module loaded');
} catch (e) {
  console.warn('[bot] db module NOT loaded.', e.message);
}

// ==========================================
// 1. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================

// Отправка запросов в Telegram
async function tg(method, payload) {
  if (!BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN empty' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String(e.message) };
  }
}

// Проверка подписи InitData (для защиты запросов с фронтенда)
function verifyTelegramWebAppData(telegramInitData) {
  if (!telegramInitData) return null;
  const encoded = decodeURIComponent(telegramInitData);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const arr = encoded.split('&');
  const hashIndex = arr.findIndex(str => str.startsWith('hash='));
  if (hashIndex === -1) return null;
  const hash = arr.splice(hashIndex, 1)[0].split('=')[1];
  arr.sort((a, b) => a.localeCompare(b));
  const _hash = crypto.createHmac('sha256', secret).update(arr.join('\n')).digest('hex');
  if (_hash !== hash) return null;
  return JSON.parse(arr.find(s => s.startsWith('user=')).split('user=')[1]);
}

// Логика начисления баланса (Универсальная для Stars и TON)
async function creditUserBalance(userId, amount, type, txData, uniqueId) {
    if (!db) return console.error('[db] No connection');
    
    await db.query('BEGIN');

    // Проверка на дубликат (Идемпотентность)
    // Для TON уникальным ID будет hash транзакции, для Stars - charge_id
    // Мы сохраняем уникальный ID в JSON meta, чтобы искать по нему
    const checkDup = await db.query(
        `SELECT id FROM balance_tx WHERE meta->>'unique_id' = $1`, 
        [uniqueId]
    );
    
    if (checkDup.rows.length > 0) {
        await db.query('ROLLBACK');
        return { success: true, duplicate: true }; // Уже обработано
    }

    // Создаем юзера если нет
    await db.query(`
      INSERT INTO users (telegram_id) VALUES ($1)
      ON CONFLICT (telegram_id) DO NOTHING
    `, [userId]);

    // Начисляем баланс
    const res = await db.query(`
      INSERT INTO balances (user_id, stars) VALUES ($1, $2)
      ON CONFLICT (user_id) 
      DO UPDATE SET stars = balances.stars + $2, updated_at = NOW()
      RETURNING stars
    `, [userId, amount]);

    const newBalance = res.rows[0].stars;

    // Пишем историю (добавляем unique_id в мету для защиты от дублей)
    await db.query(`
      INSERT INTO balance_tx (user_id, type, amount, balance_after, meta)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, type, amount, newBalance, JSON.stringify({ ...txData, unique_id: uniqueId })]);

    await db.query('COMMIT');
    console.log(`[balance] User ${userId} +${amount} (${type}). New: ${newBalance}`);
    return { success: true, newBalance };
}

// ==========================================
// 2. ЛОГИКА ПРОВЕРКИ TON (Вызывается фронтендом)
// ==========================================
async function checkTonPayment(req, res) {
    try {
        // Авторизация
        const initData = req.headers['x-telegram-data'];
        const user = verifyTelegramWebAppData(initData);
        if (!user) return res.status(401).json({ error: 'Auth failed' });

        const userId = user.id;
        const searchComment = `user_${userId}`; 

        // Запрос в блокчейн
        const response = await fetch(TON_API_URL);
        const data = await response.json();
        if (!data.ok) return res.status(500).json({ error: 'Blockchain API error' });

        let foundTx = null;

        // Поиск транзакции
        for (const tx of data.result) {
            if (!tx.in_msg || !tx.in_msg.message) continue;
            if (tx.in_msg.message === searchComment) {
                foundTx = { 
                    hash: tx.transaction_id.hash, 
                    valueNano: tx.in_msg.value 
                };
                break; // Берем первую подходящую
            }
        }

        if (!foundTx) {
            return res.json({ success: false, message: 'Payment not found yet' });
        }

        // Расчет звезд (1 TON = 110 Stars)
        const tonAmount = foundTx.valueNano / 1000000000;
        const starsToAdd = Math.floor(tonAmount * 110);

        // Начисление через общую функцию
        const result = await creditUserBalance(
            userId, 
            starsToAdd, 
            'topup_ton', 
            { hash: foundTx.hash, ton: tonAmount }, 
            foundTx.hash // Уникальный ID для TON - это хеш
        );

        return res.json({ success: true, addedStars: starsToAdd, ...result });

    } catch (e) {
        console.error('[ton] Error:', e);
        return res.status(500).json({ error: 'Server error' });
    }
}

// ==========================================
// 3. MAIN HANDLER (Единая точка входа)
// ==========================================
module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json({ status: 'Bot OK' });

    // --- МАРШРУТИЗАЦИЯ ---
    
    // А) Если это запрос от твоего фронтенда на проверку TON
    if (req.body && req.body.action === 'check_ton') {
        return await checkTonPayment(req, res);
    }

    // Б) Если это Webhook от Telegram
    let update = req.body;
    if (typeof update === 'string') try { update = JSON.parse(update); } catch {}
    
    // Логика Stars (Webhook)
    if (update.pre_checkout_query) {
      await tg('answerPreCheckoutQuery', {
        pre_checkout_query_id: update.pre_checkout_query.id, ok: true
      });
      return res.status(200).json({ ok: true });
    }

    const msg = update.message || update.edited_message;

    // Оплата Stars прошла успешно
    if (msg && msg.successful_payment) {
      const pay = msg.successful_payment;
      await creditUserBalance(
          msg.from.id,
          pay.total_amount, // Сумма Stars
          'topup_stars',
          { payload: pay.invoice_payload },
          pay.telegram_payment_charge_id // Уникальный ID платежа от Telegram
      );
      await tg('sendMessage', { chat_id: msg.chat.id, text: `✅ Баланс пополнен на ${pay.total_amount} звезд!` });
    }

    // Команда /start
    if (msg?.text?.startsWith('/start')) {
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text: 'Испытай удачу в Lambo Drop! 👇',
        reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть', web_app: { url: WEBAPP_URL } }]] }
      });
    }

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('[bot] Fatal:', e);
    return res.status(200).json({ ok: false });
  }
};
