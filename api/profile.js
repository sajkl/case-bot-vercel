// api/profile.js
module.exports = (req, res) => {
  // Можно хранить реальный баланс, тут — заглушка
  res.status(200).json({ stars: 25 });
};
