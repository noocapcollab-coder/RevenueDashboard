// api/client-revenue.js — client-facing, single-creator revenue endpoint.
// Takes ?k=<portal key>, maps it to a creator SERVER-SIDE, and returns ONLY that
// creator's sponsor videos with amount / paid / cycle, plus that creator's cut %.
// It never returns other creators or agency-wide totals, so the key can't be
// tampered with to reveal anyone else's numbers.

const { KEY_TO_NAME } = require("../lib/creators.js");

const NOTION = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const TOKEN = process.env.NOTION_TOKEN;

const REV_DS = "9f799a64-92cb-4d7b-83b7-100f5bc77464";   // Sponsor Video Revenue
const CUT_DS = "d63fb0df-db77-4cd9-9c94-0d74a36cfebf";   // Creator Cut

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

async function queryAll(dataSourceId) {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await fetch(`${NOTION}/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
      },
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
function statusOf(page) {
  const p = props(page);
  const c = p["Status"] || p["status"] || p["STATUS"];
  if (!c) return "";
  if (c.type === "status") return c.status ? c.status.name : "";
  if (c.type === "select") return c.select ? c.select.name : "";
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
function cycleOf(page) {
  for (const [name, v] of Object.entries(props(page))) {
    if (!/month/i.test(name)) continue;
    if (v.type === "select" && v.select) return v.select.name.trim();
    if (v.type === "status" && v.status) return v.status.name.trim();
    if (v.type === "multi_select" && Array.isArray(v.multi_select) && v.multi_select[0]) return v.multi_select[0].name.trim();
  }
  return "";
}
function videoDate(page) {
  const entries = Object.entries(props(page)).filter(([, v]) => v.type === "date" && v.date && v.date.start);
  if (!entries.length) return "";
  const score = (name) => {
    const n = name.toLowerCase();
    if (/post/.test(n)) return 5;
    if (n === "da" || /\bdate\b/.test(n) || /air|publish/.test(n)) return 4;
    if (/due/.test(n)) return 2;
    return 1;
  };
  entries.sort((a, b) => score(b[0]) - score(a[0]));
  return (entries[0][1].date.start || "").slice(0, 10);
}
const num = (page, name) => { const v = props(page)[name]; return v && v.type === "number" ? v.number : null; };
const selectName = (page, name) => { const v = props(page)[name]; return v && v.type === "select" && v.select ? v.select.name : ""; };
const checkbox = (page, name) => { const v = props(page)[name]; return !!(v && v.type === "checkbox" && v.checkbox); };
const urlOf = (page, name) => { const v = props(page)[name]; return v && v.type === "url" ? v.url : ""; };
const dateStart = (page, name) => { const v = props(page)[name]; return v && v.type === "date" && v.date ? v.date.start : ""; };

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!TOKEN) throw new Error("Missing NOTION_TOKEN");
    const key = (req.query && (req.query.k || req.query.key)) || "";
    const creator = KEY_TO_NAME[key];
    if (!creator) {
      res.status(404).json({ ok: false, error: "This portal link isn't active. Check with NOOCAP." });
      return;
    }

    const dsList = BOARDS[creator] || [];
    let pages = [];
    for (const ds of dsList) {
      try { pages = pages.concat(await queryAll(ds)); } catch { /* skip unreachable board */ }
    }

    let videos = pages
      .filter(isSponsor)
      .map((pg) => ({ title: titleOf(pg) || "(untitled)", status: statusOf(pg), link: pg.url || pg.id, cycle: cycleOf(pg), date: videoDate(pg) }))
      .filter((v) => v.status !== "Archive");
    const seen = new Set();
    videos = videos.filter((v) => { if (!v.link || seen.has(v.link)) return false; seen.add(v.link); return true; });

    // Revenue rows for THIS creator only
    let revRows = [];
    try { revRows = (await queryAll(REV_DS)).filter((pg) => selectName(pg, "Creator") === creator); } catch { /* none */ }
    const revByLink = {};
    revRows.forEach((pg) => {
      const l = urlOf(pg, "Video Link");
      if (l) revByLink[l] = { amount: num(pg, "Amount USD"), paid: checkbox(pg, "Paid"), paidDate: dateStart(pg, "Payment Received") };
    });

    // This creator's cut %
    let cutPct = 0;
    try {
      const row = (await queryAll(CUT_DS)).find((pg) => titleOf(pg) === creator);
      if (row) cutPct = num(row, "Cut Percent") || 0;
    } catch { /* default 0 */ }

    const out = videos.map((v) => {
      const r = revByLink[v.link];
      return {
        title: v.title,
        status: v.status,
        cycle: v.cycle,
        date: v.date,
        link: v.link,
        amount: r ? r.amount : null,
        paid: r ? r.paid : false,
        paidDate: r ? r.paidDate : "",
      };
    });
    out.sort((a, b) => a.title.localeCompare(b.title));

    res.status(200).json({ ok: true, creator, cutPct, videos: out, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
};
