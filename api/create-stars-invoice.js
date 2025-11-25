// /api/create-stars-invoice.js
'use strict';

const crypto = require('crypto');
const db = require('../db');

const BOT_TOKEN  = (process.env.BOT_TOKEN || '').trim();
const APP_SECRET = (process.env.APP_SECRET || (BOT_TOKEN + ':dev')).trim();

function verifyJwt(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;

  const checkSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');

  if (checkSig !== sigB64) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function parseSidCookie(req) {
  const header = req.headers.cookie || '';
  const m = header.match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function tg(method, payload) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload || {})
  });
  return r.json().catch(() => ({}));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, reason:'method not allowed' });
    }

    const token = parseSidCookie(req);
    const payload = verifyJwt(token, APP_SECRET);
    if (!payload || !payload.sub) {
      return res.status(401).json({ ok:false, reason:'no session' });
    }

    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});
    const amount = Number(body.amount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(200).json({ ok:false, reason:'bad amount' });
    }

    // Пока считаем 1 Star = 1 ★
    const starsToBuy = amount;

    // Создаём инвойс в Telegram (для Stars формат надо будет уточнить по доке,
    // здесь — классический createInvoiceLink для наглядности)
    const title = `Покупка ${amount} ★`;
    const description = `Пополнение баланса на ${amount} ★`;
    const currency = 'XTR'; // для Stars используется спец. "валюта" XTR
    const prices = [
      { label: `${amount} ★`, amount: starsToBuy } // amount в минимальных единицах (как см. в доке)
    ];

    const resp = await tg('createInvoiceLink', {
      title,
      description,
      currency,
      prices,
      // payload, provider_data и пр. по ситуации
    });

    if (!resp.ok) {
      console.error('createInvoiceLink error', resp);
      return res.status(200).json({ ok:false, reason:'telegram error', error:resp.description });
    }

    const invoiceLink = resp.result;
    return res.status(200).json({ ok:true, invoice_link: invoiceLink });
  } catch (e) {
    console.error('/api/create-stars-invoice fatal:', e);
    return res.status(200).json({ ok:false, reason:'exception', error:String(e?.message||e) });
  }
};
