import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

// команда /start — высылает inline-кнопку с WebApp
bot.start((ctx) => {
  ctx.reply('Открой мини-апп 👇', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🚀 Открыть Lambo Drop',
          web_app: { url: 'https://case-bot-vercel.vercel.app/profile/' } // твой URL
        }
      ]]
    }
  });
});

// для проверки, что бот жив
bot.command('ping', (ctx) => ctx.reply('pong ✅'));

// экспорт для Vercel (обязательно!)
export default async function handler(req, res) {
  try {
    await bot.handleUpdate(JSON.parse(req.body), res);
    res.status(200).end();
  } catch (err) {
    console.error('Bot error:', err);
    res.status(500).end();
  }
}
