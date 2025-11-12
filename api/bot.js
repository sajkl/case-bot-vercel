// /api/bot.js
const { Telegraf } = require('telegraf');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
if (!BOT_TOKEN) console.error('BOT_TOKEN is missing');

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9000 });

bot.start((ctx) => ctx.reply('Открой мини-апп 👇', {
  reply_markup: {
    inline_keyboard: [[
      { text: '🚀 Открыть Lambo Drop', web_app: { url: 'https://case-bot-vercel.vercel.app/profile/' } }
    ]]
  }
}));

bot.command('ping', (ctx) => ctx.reply('pong ✅'));

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, hint: 'POST Telegram update JSON here' });
  }
  try {
    await bot.handleUpdate(req.body, res);
    if (!res.headersSent) res.status(200).end();
  } catch (e) {
    console.error('bot.handleUpdate error:', e);
    if (!res.headersSent) res.status(200).end();
  }
};

  // Для удобной проверки из браузера
  return res.status(200).json({ ok: true, hint: 'POST Telegram update JSON here' });
}
