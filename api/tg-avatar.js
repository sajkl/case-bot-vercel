// /api/tg-avatar.js
export const config = { api: { bodyParser: false } }; // отдаём бинарь
const TG = (method, body, token) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  }).then(r=>r.json());

export default async function handler(req, res) {
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const user_id = Number(req.query.user_id);
    if (!BOT_TOKEN || !user_id) return res.status(400).end();

    // 1) список фото
    const ph = await TG('getUserProfilePhotos', { user_id, limit:1 }, BOT_TOKEN);
    const fileId = ph?.result?.photos?.[0]?.[0]?.file_id;
    if (!fileId) return res.status(204).end(); // нет фото

    // 2) получаем file_path
    const gf = await TG('getFile', { file_id: fileId }, BOT_TOKEN);
    const filePath = gf?.result?.file_path;
    if (!filePath) return res.status(204).end();

    // 3) скачиваем и проксируем
    const fileResp = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    if (!fileResp.ok) return res.status(204).end();

    res.setHeader('Content-Type', fileResp.headers.get('Content-Type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400'); // кэш сутки
    const buf = Buffer.from(await fileResp.arrayBuffer());
    res.status(200).end(buf);
  } catch {
    res.status(204).end();
  }
}
