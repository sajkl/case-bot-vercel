// /api/bot.js
import { Telegraf } from 'telegraf';

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing');
}

const bot = new Telegraf(BOT_TOKEN);

// /start — шлём кнопку с WebApp
bot.start((ctx) => {
  return ctx.reply('Открой мини-апп 👇', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 Открыть Lambo Drop', web_app: { url: 'https://case-bot-vercel.vercel.app/profile/' } }
      ]]
    }
  });
});

// простой ping
bot.command('ping', (ctx) => ctx.reply('pong ✅'));

// Vercel webhook handler
export default async function handler(req, res) {
  // Telegram шлёт JSON с header "application/json" → Vercel парсит в req.body (object)
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      return res.status(200).end(); // важно вернуть 200 быстро
    } catch (e) {
      console.error('bot.handleUpdate error:', e);
      return res.status(200).end(); // всё равно 200, чтобы Telegram не ретраил бесконечно
    }
  }

  // Для удобной проверки из браузера
  return res.status(200).json({ ok: true, hint: 'POST Telegram update JSON here' });
}
