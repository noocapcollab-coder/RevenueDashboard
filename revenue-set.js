// NOOCAP Sponsor Revenue — write endpoint
// Upserts one row in the Sponsor Video Revenue table.
// POST body: { revPageId?, link, title, creator, amount, paid, paidDate, brand? }

const NOTION = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const TOKEN = process.env.NOTION_TOKEN;
const REV_DS = "9f799a64-92cb-4d7b-83b7-100f5bc77464";

function buildProps(b) {
  const p = {};
  if (b.title != null) p["Video Title"] = { title: [{ text: { content: String(b.title).slice(0, 200) } }] };
  if (b.creator) p["Creator"] = { select: { name: b.creator } };
  if (b.amount === null || b.amount === "" || typeof b.amount === "undefined") {
    p["Amount USD"] = { number: null };
  } else {
    const n = Number(b.amount);
    p["Amount USD"] = { number: isNaN(n) ? null : n };
  }
  p["Paid"] = { checkbox: !!b.paid };
  p["Payment Received"] = b.paid && b.paidDate ? { date: { start: b.paidDate } } : { date: null };
  if (b.link) p["Video Link"] = { url: b.link };
  if (typeof b.brand === "string") p["Brand"] = { rich_text: [{ text: { content: b.brand.slice(0, 200) } }] };
  return p;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
    if (!TOKEN) throw new Error("NOTION_TOKEN is not set");
    const b = await readBody(req);
    if (!b.link && !b.revPageId) throw new Error("link or revPageId required");

    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": VERSION,
      "Content-Type": "application/json",
    };
    const properties = buildProps(b);

    let r;
    if (b.revPageId) {
      r = await fetch(`${NOTION}/pages/${b.revPageId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ properties }),
      });
    } else {
      r = await fetch(`${NOTION}/pages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: REV_DS },
          properties,
        }),
      });
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Notion ${r.status}: ${t.slice(0, 300)}`);
    }
    const page = await r.json();
    res.status(200).json({ ok: true, revPageId: page.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
