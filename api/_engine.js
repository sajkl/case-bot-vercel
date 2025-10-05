// api/_engine.js
import fetch from 'node-fetch';

const TG_GIFT_API = 'https://tg.me/gifts/available_gifts';

export async function fetchAvailableGifts() {
  try {
    const res = await fetch(TG_GIFT_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.gifts || [];
  } catch (err) {
    console.error('Error fetching gifts:', err);
    return [];
  }
}

// Возвращает список подарков из коллекции, доступных за звезды
export async function getStarGiftsByCollection(collectionName) {
  const all = await fetchAvailableGifts();
  const gifts = all.filter(
    g =>
      g.collection?.toLowerCase() === collectionName.toLowerCase() &&
      g.price &&
      g.price.currency === 'stars'
  );
  gifts.sort((a, b) => a.price.amount - b.price.amount);
  return gifts;
}

// Возвращает вторую по цене позицию (для защиты от минуса)
export async function getSafeGiftPrice(collectionName) {
  const gifts = await getStarGiftsByCollection(collectionName);
  if (gifts.length < 2) return null;
  return gifts[1]; // второй по минимальной цене
}

// Пересчёт цены кейса через RTP
export function calculateCasePrice(prizes) {
  const totalWeight = prizes.reduce((sum, p) => sum + (p.weight || 1), 0);
  const expectedValue =
    prizes.reduce((sum, p) => sum + (p.value * (p.weight || 1)), 0) /
    Math.max(1, totalWeight);

  const casePrice = expectedValue * 0.8 * 1.08; // RTP 80% + 8% наценка
  return Math.round(casePrice);
}
