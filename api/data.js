// api/data.js

const CASES = {
  // --- КЕЙС 1: ЖИГА (199 ★) ---
  // "Прогревочный" кейс. RTP 93%. Почти невозможно уйти в большой минус.
  jiga: {
    title: 'Жига',
    price: 199,
    items: [
      // Common (Частые, легкий минус)
      { id: 'gift_ramen',   name: 'Instant Ramen', chance: 40, value: 176, image: '/assets/prizes/ramen.png', rarity: 'common' }, // 2.08 TON
      { id: 'gift_lolly',   name: 'Lol Pop',       chance: 25, value: 176, image: '/assets/prizes/lollipop.png', rarity: 'common' }, // 2.08 TON
      { id: 'gift_ice',     name: 'Ice Cream',     chance: 15, value: 184, image: '/assets/prizes/icecream.png', rarity: 'common' }, // 2.17 TON
      // Rare (Небольшой плюс)
      { id: 'gift_brownie', name: 'Happy Brownie', chance: 10, value: 202, image: '/assets/prizes/brownie.png', rarity: 'rare' },   // 2.38 TON
      { id: 'gift_candy',   name: 'Candy Cane',    chance: 5,  value: 208, image: '/assets/prizes/candy.png', rarity: 'rare' },     // 2.45 TON
      // Legendary (Окуп x1.5)
      { id: 'gift_wreath',  name: 'Winter Wreath', chance: 4,  value: 250, image: '/assets/prizes/wreath.png', rarity: 'legendary' }, // 2.95 TON
      { id: 'gift_bells',   name: 'Jingle Bells',  chance: 1,  value: 311, image: '/assets/prizes/bells.png', rarity: 'legendary' }  // 3.66 TON
    ]
  },

  // --- КЕЙС 2: КАМРИ (399 ★) ---
  // Рабочая лошадка. RTP 77%. Маржа казино 23%.
  camry: {
    title: 'Камри',
    price: 399,
    items: [
      // Common (Минус 30-35%)
      { id: 'gift_drink',   name: 'Holiday Drink', chance: 18, value: 255, image: '/assets/prizes/drink.png', rarity: 'common' }, // 3.00 TON
      { id: 'gift_notepad', name: 'Star Notepad',  chance: 18, value: 256, image: '/assets/prizes/notepad.png', rarity: 'common' }, // 3.02 TON
      { id: 'gift_witch',   name: 'Witch Hat',     chance: 20, value: 308, image: '/assets/prizes/witch.png', rarity: 'common' },    // 3.63 TON
      // Rare (Почти возврат)
      { id: 'gift_bells',   name: 'Jingle Bells',  chance: 15, value: 311, image: '/assets/prizes/bells.png', rarity: 'rare' },   // 3.66 TON
      { id: 'gift_globe',   name: 'Snow Globe',    chance: 15, value: 351, image: '/assets/prizes/snowglobe.png', rarity: 'rare' }, // 4.14 TON
      // Legendary (Неплохой плюс)
      { id: 'gift_hat',     name: 'Santa Hat',     chance: 10, value: 364, image: '/assets/prizes/santahat.png', rarity: 'legendary' }, // 4.29 TON
      { id: 'gift_eye',     name: 'Evil Eye',      chance: 4,  value: 450, image: '/assets/prizes/evileye.png', rarity: 'legendary' }  // 5.30 TON
    ]
  },

  // --- КЕЙС 3: БЭХА (899 ★) ---
  // Высокие ставки. RTP 78%.
  bmw: {
    title: 'Бэха',
    price: 899,
    items: [
      // Common (Потеря 50%)
      { id: 'gift_chimp',   name: 'Jolly Chimp',   chance: 15, value: 425, image: '/assets/prizes/chimp.png', rarity: 'common' }, // 5.01 TON
      { id: 'gift_eye',     name: 'Evil Eye',      chance: 15, value: 450, image: '/assets/prizes/evileye.png', rarity: 'common' }, // 5.30 TON
      // Rare (Минус/Возврат)
      { id: 'gift_sleigh',  name: 'Sleigh Bell',   chance: 20, value: 652, image: '/assets/prizes/sleigh.png', rarity: 'rare' },   // 7.68 TON
      { id: 'gift_cigar',   name: 'Snoop Cigar',   chance: 25, value: 759, image: '/assets/prizes/cigar.png', rarity: 'rare' },    // 8.93 TON
      { id: 'gift_record',  name: 'Record Player', chance: 16, value: 890, image: '/assets/prizes/record.png', rarity: 'rare' },    // 10.48 TON
      // Legendary (Профит)
      { id: 'gift_dryer',   name: 'Ionic Dryer',   chance: 7,  value: 1065, image: '/assets/prizes/dryer.png', rarity: 'legendary' }, // 12.54 TON
      { id: 'gift_rose',    name: 'Eternal Rose',  chance: 2,  value: 1517, image: '/assets/prizes/rose.png', rarity: 'legendary' }   // 17.85 TON
    ]
  },

  // --- КЕЙС 4: ЛАМБО (2499 ★) ---
  // Премиум. RTP 79%. Шанс на джекпот 10к звезд.
  lambo: {
    title: 'Ламбо',
    price: 2499,
    items: [
      // Common (Потеря ~1000 звезд)
      { id: 'gift_stiletto',name: 'Sky Stiletto',  chance: 20, value: 1487, image: '/assets/prizes/stiletto.png', rarity: 'common' }, // 17.5 TON
      { id: 'gift_jar',     name: 'Restless Jar',  chance: 20, value: 1487, image: '/assets/prizes/jar.png', rarity: 'common' },      // 17.5 TON
      { id: 'gift_rose',    name: 'Eternal Rose',  chance: 20, value: 1517, image: '/assets/prizes/rose.png', rarity: 'common' },     // 17.85 TON
      // Rare (Небольшой минус)
      { id: 'gift_berry',   name: 'Berry Box',     chance: 18, value: 1605, image: '/assets/prizes/berry.png', rarity: 'rare' },      // 18.89 TON
      // Legendary (Возврат / Профит)
      { id: 'gift_neko',    name: 'Neko Helmet',   chance: 14, value: 2453, image: '/assets/prizes/helmet.png', rarity: 'legendary' }, // 28.86 TON
      { id: 'gift_ring',    name: 'Diamond Ring',  chance: 7,  value: 4734, image: '/assets/prizes/ring.png', rarity: 'mythical' },    // 55.70 TON
      { id: 'gift_shard',   name: 'Astral Shard',  chance: 1,  value: 10778, image: '/assets/prizes/shard.png', rarity: 'mythical' }   // 126.80 TON
    ]
  }
};

module.exports = { CASES };
