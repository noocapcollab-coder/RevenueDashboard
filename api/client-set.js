// api/client-set.js — client-facing write endpoint.
// A client (identified only by ?k=<portal key>) can set the amount and paid
// status on ONE of their own sponsor videos. The creator is resolved SERVER-SIDE
// from the key, and the video link is verified to actually live on that creator's
// board before anything is written — so a tampered link can't touch another
// creator's row. The Creator field is always written from the resolved name,
// never from client input.

const { KEY_TO_NAME } = require("../lib/creators.js");

const NOTION = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const TOKEN = process.env.NOTION_TOKEN;
const REV_DS = "9f799a64-92cb-4d7b-83b7-100f5bc77464";

const BOARDS = {
  Brad: ["28b508e9-9dda-81ba-8d7f-000b84b83fbd"],
  Chris: ["2a1508e9-9dda-8125-bd63-000bb75578dd", "337508e9-9dda-806a-b4e7-000b6cee3fb6"],
  Lindsay: ["301508e9-9dda-811b-83c7-000b46be09b1", "65e508e9-9dda-8201-8e80-871793a70fa9"],
  Emtech: ["328508e9-9dda-8000-b3c9-000b0d791507"],
  Duncan: ["328508e9-9dda-8186-b4ca-000bd212e84b"],
  Valeri: ["f0dbec00-505d-4e16-8e51-b2fcfea21445"],
  Dymtro: ["36b508e9-9dda-8004-a37f-000b460c8c46"],
  Jonathan: ["370508e9-9dda-807b-9554-000ba747fde7"],
};

const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  "Notion-Version": VERSION,
  "Content-Type": "application/json",
});

async function queryAll(dataSourceId) {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await fetch(`${NOTION}/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Notion ${r.status}`);
    const j = await r.json();
    rows.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return rows;
}

function props(p) { return p.properties || {}; }
function titleOf(page) {
  for (const v of Object.values(props(page)))
    if (v.type === "title") return (v.title || []).map((t) => t.plain_text).join("").trim();
  return "";
}
function isSponsor(page) {
  for (const v of Object.values(props(page))) {
    if (v.type === "select" && v.select && /sponsor/i.test(v.select.name)) return true;
    if (v.type === "status" && v.status && /sponsor/i.test(v.status.name)) return true;
    if (v.type === "multi_select" && Array.isArray(v.multi_select) && v.multi_select.some((o) => /sponsor/i.test(o.name))) return true;
  }
  return false;
}
const selectName = (page, name) => { const v = props(page)[name]; return v && v.type === "select" && v.select ? v.select.name : ""; };
const urlOf = (page, name) => { const v = props(page)[name]; return v && v.type === "url" ? v.url : ""; };

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
    if (!TOKEN) throw new Error("Missing NOTION_TOKEN");

    const key = (req.query && (req.query.k || req.query.key)) || "";
    const creator = KEY_TO_NAME[key];
    if (!creator) return res.status(404).json({ ok: false, error: "This portal link isn't active. Check with NOOCAP." });

    const b = await readBody(req);
    if (!b.link) return res.status(400).json({ ok: false, error: "link required" });

    // Verify the video actually belongs to THIS creator's board.
    let owned = null;
    for (const ds of BOARDS[creator] || []) {
      let pages = [];
      try { pages = await queryAll(ds); } catch { continue; }
      const hit = pages.find((pg) => (pg.url || pg.id) === b.link);
      if (hit && isSponsor(hit)) { owned = hit; break; }
    }
    if (!owned) return res.status(403).json({ ok: false, error: "That video isn't on your board." });

    // Find this creator's existing revenue row for that video.
    let existing = null;
    try {
      existing = (await queryAll(REV_DS)).find(
        (pg) => urlOf(pg, "Video Link") === b.link && selectName(pg, "Creator") === creator
      );
    } catch { /* create fresh */ }

    const amtRaw = b.amount;
    let amount = null;
    if (!(amtRaw === null || amtRaw === "" || typeof amtRaw === "undefined")) {
      const n = Number(amtRaw);
      amount = isNaN(n) ? null : Math.max(0, n);
    }
    const paid = !!b.paid;
    const paidDate = paid ? (b.paidDate || new Date().toISOString().slice(0, 10)) : "";

    const properties = {
      "Video Title": { title: [{ text: { content: (titleOf(owned) || "(untitled)").slice(0, 200) } }] },
      "Creator": { select: { name: creator } },   // server-set, never from the client
      "Amount USD": { number: amount },
      "Paid": { checkbox: paid },
      "Payment Received": paid && paidDate ? { date: { start: paidDate } } : { date: null },
      "Video Link": { url: b.link },
    };

    const r = existing
      ? await fetch(`${NOTION}/pages/${existing.id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ properties }) })
      : await fetch(`${NOTION}/pages`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: REV_DS }, properties }),
        });
    if (!r.ok) throw new Error(`Notion ${r.status}: ${(await r.text()).slice(0, 200)}`);

    const page = await r.json();
    res.status(200).json({ ok: true, revPageId: page.id, amount, paid, paidDate });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
