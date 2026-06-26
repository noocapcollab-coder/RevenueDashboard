// NOOCAP Sponsor Revenue — delete endpoint
// Archives a video's row in the Sponsor Video Revenue table (moves it to Notion
// trash, recoverable). Leaves the creator's board untouched.
// POST body: { revPageId }

const NOTION = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const TOKEN = process.env.NOTION_TOKEN;

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
    if (!b.revPageId) throw new Error("revPageId required");

    const r = await fetch(`${NOTION}/pages/${b.revPageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) throw new Error(`Notion ${r.status}: ${(await r.text()).slice(0, 300)}`);
    res.status(200).json({ ok: true, revPageId: b.revPageId });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
