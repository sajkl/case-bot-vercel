export const config = { api: { bodyParser: false } };

async function tg(method, data, token) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  }).then(r=>r.json());
}

export default async function handler(req,res){
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const user_id = Number(req.query.user_id);
  if (!BOT_TOKEN || !user_id) return res.status(400).end();

  const ph = await tg('getUserProfilePhotos', {user_id,limit:1}, BOT_TOKEN);
  const file_id = ph?.result?.photos?.[0]?.[0]?.file_id;
  if (!file_id) return res.status(204).end();

  const gf = await tg('getFile', {file_id}, BOT_TOKEN);
  const path = gf?.result?.file_path;
  if (!path) return res.status(204).end();

  const f = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
  res.setHeader('Content-Type', f.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control','public, max-age=86400');
  res.end(Buffer.from(await f.arrayBuffer()));
}

