// api/login.js — exchanges the shared password for a signed token.
//
//   POST /api/login   { "password": "..." }  ->  { "ok": true, "token": "..." }
//
// Wrong answers are slowed down so the password can't be guessed quickly.

const { passwordOk, makeToken } = require("../lib/auth.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ ok: false, error: "ADMIN_PASSWORD is not set in Vercel" });
  }

  const body = await readBody(req);

  if (!passwordOk(body && body.password)) {
    await sleep(700);
    return res.status(401).json({ ok: false, error: "Wrong password" });
  }

  return res.status(200).json({ ok: true, token: makeToken() });
};
