// NOOCAP Sponsor Revenue — read endpoint (internal only)
// Reads sponsor-tagged videos from each creator's board(s), merges the Sponsor Video
// Revenue table, suggests amounts from the Brand Deals Pipeline, and applies per-creator
// cut percentages. Resilient: a source that can't be read is skipped and reported in
// `warnings` rather than failing the whole dashboard.

const NOTION = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const TOKEN = process.env.NOTION_TOKEN;

const REV_DS = "9f799a64-92cb-4d7b-83b7-100f5bc77464";   // Sponsor Video Revenue
const DEALS_DS = "70d26268-6d57-4d45-abf7-a599c6f8e0f4"; // Brand Deals Pipeline
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
    if (!r.ok) {
      const t = await r.text();
      const code = (() => { try { return JSON.parse(t).code; } catch { return r.status; } })();
      throw new Error(String(code));
    }
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
function num(page, name) { const v = props(page)[name]; return v && v.type === "number" ? v.number : null; }
function selectName(page, name) { const v = props(page)[name]; return v && v.type === "select" && v.select ? v.select.name : ""; }
function checkbox(page, name) { const v = props(page)[name]; return !!(v && v.type === "checkbox" && v.checkbox); }
function urlOf(page, name) { const v = props(page)[name]; return v && v.type === "url" ? v.url : ""; }
function dateStart(page, name) { const v = props(page)[name]; return v && v.type === "date" && v.date ? v.date.start : ""; }

module.exports = async function handler(req, res) {
  try {
    if (!TOKEN) throw new Error("NOTION_TOKEN is not set");

    const warnings = [];
    async function safeQuery(ds, label) {
      try { return await queryAll(ds); }
      catch (e) { warnings.push(`${label} couldn't be read (${String(e.message || e)})`); return []; }
    }

    // Boards (resilient per board)
    const tasks = [];
    for (const [creator, dsList] of Object.entries(BOARDS)) {
      for (const ds of dsList) {
        tasks.push(
          safeQuery(ds, creator).then((pages) =>
            pages
              .filter(isSponsor)
              .map((pg) => ({ creator, title: titleOf(pg) || "(untitled)", status: statusOf(pg), link: pg.url }))
              .filter((v) => v.status !== "Archive")
          )
        );
      }
    }
    const seen = new Set();
    const videos = (await Promise.all(tasks)).flat().filter((v) => {
      if (!v.link || seen.has(v.link)) return false;
      seen.add(v.link);
      return true;
    });

    const revRows = (await safeQuery(REV_DS, "Revenue table")).map((pg) => ({
      revPageId: pg.id,
      link: urlOf(pg, "Video Link"),
      amount: num(pg, "Amount USD"),
      paid: checkbox(pg, "Paid"),
      paidDate: dateStart(pg, "Payment Received"),
    }));
    const revByLink = {};
    revRows.forEach((r) => { if (r.link) revByLink[r.link] = r; });

    const deals = (await safeQuery(DEALS_DS, "Deals pipeline")).map((pg) => ({
      creator: selectName(pg, "Creator"),
      brand: titleOf(pg),
      rate: num(pg, "Final Rate USD") ?? num(pg, "Offer Amount"),
    }));
    function suggest(creator, title) {
      const t = (title || "").toLowerCase();
      const hit = deals.find((d) => d.creator === creator && d.rate && d.brand && t.includes(d.brand.toLowerCase()));
      return hit ? hit.rate : null;
    }

    const cuts = {};
    (await safeQuery(CUT_DS, "Creator Cut")).forEach((pg) => {
      const c = titleOf(pg);
      if (c) cuts[c] = num(pg, "Cut Percent") || 0;
    });

    const merged = videos.map((v) => {
      const rev = revByLink[v.link];
      return {
        creator: v.creator,
        title: v.title,
        status: v.status,
        link: v.link,
        revPageId: rev ? rev.revPageId : null,
        amount: rev ? rev.amount : null,
        paid: rev ? rev.paid : false,
        paidDate: rev ? rev.paidDate : "",
        suggested: rev && rev.amount ? null : suggest(v.creator, v.title),
      };
    });
    merged.sort((a, b) => (a.creator === b.creator ? a.title.localeCompare(b.title) : a.creator.localeCompare(b.creator)));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, generatedAt: new Date().toISOString(), videos: merged, cuts, warnings });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
