// api/login.js — exchanges the shared password for a signed token.
//
//   POST /api/login   { "password": "..." }  ->  { "token": "..." }
//
// Failures are slowed down a little so the password can't be guessed quickly.

import { passwordOk, makeToken } from '../lib/auth.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set in Vercel' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  if (!passwordOk(body && body.password)) {
    await sleep(700);
    return res.status(401).json({ error: 'Wrong password' });
  }

  return res.status(200).json({ token: makeToken() });
}
