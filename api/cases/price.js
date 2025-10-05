// api/cases/price.js
import { getSafeGiftPrice, calculateCasePrice } from '../_engine.js';

export default async function handler(req, res) {
  try {
    const { collection } = req.query;
    if (!collection) return res.status(400).json({ error: 'Missing collection' });

    const gift = await getSafeGiftPrice(collection);
    if (!gift) return res.status(404).json({ error: 'No gifts found for collection' });

    const caseData = {
      collection,
      basePrice: gift.price.amount,
      casePrice: calculateCasePrice([
        { value: gift.price.amount, weight: 10 },
        { value: gift.price.amount * 2, weight: 3 },
        { value: gift.price.amount * 5, weight: 1 },
      ]),
    };

    res.status(200).json(caseData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Price calculation failed' });
  }
}
