// NOOCAP Sponsor Revenue — cut write endpoint
// Upserts a creator's NOOCAP cut percentage in the Creator Cut table.
// POST body: { creator, pct }   (pct is a plain number, 20 means 20%)

const NOTION = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const TOKEN = process.env.NOTION_TOKEN;
const CUT_DS = "d63fb0df-db77-4cd9-9c94-0d74a36cfebf";

function titleOf(page) {
  for (const v of Object.values(page.properties || {}))
    if (v.type === "title") return (v.title || []).map((t) => t.plain_text).join("").trim();
  return "";
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
    if (!b.creator) throw new Error("creator required");

    const n = Number(b.pct);
    const pct = isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": VERSION,
      "Content-Type": "application/json",
    };

    // Find an existing row for this creator
    const q = await fetch(`${NOTION}/data_sources/${CUT_DS}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_size: 100 }),
    });
    if (!q.ok) throw new Error(`Notion ${q.status}: ${(await q.text()).slice(0, 200)}`);
    const existing = ((await q.json()).results || []).find((pg) => titleOf(pg) === b.creator);

    const properties = {
      "Creator": { title: [{ text: { content: b.creator } }] },
      "Cut Percent": { number: pct },
    };

    let r;
    if (existing) {
      r = await fetch(`${NOTION}/pages/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ properties }) });
    } else {
      r = await fetch(`${NOTION}/pages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: CUT_DS }, properties }),
      });
    }
    if (!r.ok) throw new Error(`Notion ${r.status}: ${(await r.text()).slice(0, 300)}`);
    res.status(200).json({ ok: true, creator: b.creator, pct });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
