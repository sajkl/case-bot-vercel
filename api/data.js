// api/data.js

const CASES = {
  // --- КЕЙС 1: ЖИГА (249 ★) ---
  // RTP: ~74% (В среднем возвращает 184 ★)
  jiga: {
    title: 'Жига',
    price: 249,
    items: [
      { id: 'gift_ramen',   name: 'Instant Ramen', chance: 50, value: 100,  image: '/assets/prizes/ramen.png', rarity: 'common' }, // x0.4 от цены
      { id: 'gift_lolly',   name: 'Lol Pop',       chance: 35, value: 200,  image: '/assets/prizes/lollipop.png', rarity: 'common' }, // x0.8
      { id: 'gift_wine',    name: 'Spiced Wine',   chance: 14, value: 350,  image: '/assets/prizes/wine.png', rarity: 'rare' },   // x1.4 (окуп)
      { id: 'gift_bells',   name: 'Jingle Bells',  chance: 1,  value: 1500, image: '/assets/prizes/bells.png',  rarity: 'legendary' }, // x6 (джекпот)
    ]
  },

  // --- КЕЙС 2: КАМРИ (499 ★) ---
  // RTP: ~74% (В среднем возвращает 371 ★)
  camry: {
    title: 'Камри',
    price: 499,
    items: [
      { id: 'gift_snow',    name: 'Snow Globe',    chance: 55, value: 200,  image: '/assets/prizes/snowglobe.png', rarity: 'common' },
      { id: 'gift_hat',     name: 'Santa Hat',     chance: 30, value: 350,  image: '/assets/prizes/santahat.png', rarity: 'common' },
      { id: 'gift_eye',     name: 'Evil Eye',      chance: 12, value: 800,  image: '/assets/prizes/evileye.png', rarity: 'rare' },
      { id: 'gift_cigar',   name: 'Snoop Cigar',   chance: 3,  value: 2000, image: '/assets/prizes/cigar.png', rarity: 'legendary' },
    ]
  },

  // --- КЕЙС 3: БЭХА (999 ★) ---
  // RTP: ~76% (В среднем возвращает 756 ★)
  bmw: {
    title: 'Бэха',
    price: 999,
    items: [
      { id: 'gift_record',  name: 'Record Player', chance: 55, value: 300,  image: '/assets/prizes/record.png', rarity: 'common' },
      { id: 'gift_cupid',   name: 'Cupid Charm',   chance: 30, value: 750,  image: '/assets/prizes/cupid.png', rarity: 'rare' },
      { id: 'gift_rose',    name: 'Eternal Rose',  chance: 12, value: 1800, image: '/assets/prizes/rose.png', rarity: 'rare' },
      { id: 'gift_helmet',  name: 'Neko Helmet',   chance: 3,  value: 5000, image: '/assets/prizes/helmet.png', rarity: 'legendary' },
    ]
  },

  // --- КЕЙС 4: ЛАМБО (2999 ★) ---
  // RTP: ~75% (В среднем возвращает 2240 ★)
  lambo: {
    title: 'Ламбо',
    price: 2999,
    items: [
      { id: 'gift_ring',    name: 'Diamond Ring',  chance: 60, value: 1000,  image: '/assets/prizes/ring.png', rarity: 'common' },
      { id: 'gift_shard',   name: 'Astral Shard',  chance: 30, value: 2500,  image: '/assets/prizes/shard.png', rarity: 'rare' },
      { id: 'gift_locket',  name: 'Heart Locket',  chance: 9,  value: 6000,  image: '/assets/prizes/locket.png', rarity: 'legendary' },
      { id: 'gift_lambo',   name: 'Real Lambo',    chance: 1,  value: 35000, image: '/assets/prizes/real_lambo.png', rarity: 'mythical' }, // x11
    ]
  }
};

module.exports = { CASES };
