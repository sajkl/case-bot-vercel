// api/gifts/stars.js
import { fetchAvailableGifts } from '../_engine.js';

export default async function handler(req, res) {
  try {
    const gifts = await fetchAvailableGifts();
    const starGifts = gifts.filter(g => g.price?.currency === 'stars');
    res.status(200).json({ gifts: starGifts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch gifts' });
  }
}
