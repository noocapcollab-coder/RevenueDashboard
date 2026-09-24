// lib/auth.js — admin gate for the revenue dashboard.
//
// No cookies anywhere, because the dashboard runs inside a frame on the CRM
// domain and browsers block third-party cookies. The page sends the token as
// an Authorization header instead, which frames are free to do.
//
// Env vars in Vercel:
//   ADMIN_PASSWORD   the shared password for Harsh and Pratham
//   AUTH_SECRET      any long random string, used to sign tokens
//
// Creator portal links (?k=...) are untouched — guard only the team endpoints.

import crypto from 'crypto';

const TTL_HOURS = 12;

function secret() {
  return process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || '';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

// Compares without leaking length or position through timing.
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function passwordOk(candidate) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  return same(candidate || '', real);
}

export function makeToken() {
  const expires = Date.now() + TTL_HOURS * 3600e3;
  const body = String(expires);
  return body + '.' + sign(body);
}

export function tokenOk(token) {
  if (!token || !secret()) return false;
  const cut = String(token).lastIndexOf('.');
  if (cut < 1) return false;
  const body = String(token).slice(0, cut);
  const mac = String(token).slice(cut + 1);
  if (!same(mac, sign(body))) return false;
  const expires = Number(body);
  return Number.isFinite(expires) && Date.now() < expires;
}

// Put this at the top of any endpoint that returns team-wide numbers.
// Returns true when the request may continue.
export function requireAdmin(req, res) {
  if (!process.env.ADMIN_PASSWORD) {
    res.status(500).json({ error: 'ADMIN_PASSWORD is not set in Vercel' });
    return false;
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!tokenOk(token)) {
    res.status(401).json({ error: 'locked' });
    return false;
  }
  return true;
}
