// api/auto/buy-send.js
import { getSafeGiftPrice } from '../_engine.js';

export default async function handler(req, res) {
  try {
    const { username, collection } = req.body;
    if (!username || !collection)
      return res.status(400).json({ error: 'Missing username or collection' });

    const gift = await getSafeGiftPrice(collection);
    if (!gift) return res.status(404).json({ error: 'No available gifts for stars' });

    // ⚙️ здесь должна быть логика покупки через Telegram Business API
    console.log(`Buying gift "${gift.name}" for @${username}`);

    res.status(200).json({
      status: 'success',
      sentTo: username,
      gift: gift.name,
      price: gift.price.amount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Auto-buy failed' });
  }
}
