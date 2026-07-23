// lib/creators.js — client portal keys for the revenue view.
// Same key strings as the NoocapV2 pipeline portal so a client reuses one link.
// Link-based access (like a Notion "anyone with link" URL), resolved server-side.
// Rotate a key here (or via CREATOR_KEYS env JSON) and redeploy to kill an old link.

const DEFAULT_CREATORS = [
  { name: "Brad",     key: "brad-8103212a67d23310" },
  { name: "Lindsay",  key: "lindsay-2fd26f3e7a617439" },
  { name: "Chris",    key: "chris-29d41aae7db6489d" },
  { name: "Duncan",   key: "duncan-650480c11f28e5bf" },
  { name: "Valeri",   key: "valeri-997a4f8fc91e8db3" },
  { name: "Emtech",   key: "emtech-47434656f30f6b20" },
  { name: "Dymtro",   key: "dymtro-3b9c1f77a204e8d1" },
  { name: "Jonathan", key: "jonathan-6a2e4c90fb15d773" },
];

function loadCreators() {
  if (process.env.CREATOR_KEYS) {
    try {
      const map = JSON.parse(process.env.CREATOR_KEYS);
      return Object.entries(map).map(([name, key]) => ({ name, key }));
    } catch { /* fall through */ }
  }
  return DEFAULT_CREATORS;
}

const CREATORS = loadCreators();
const KEY_TO_NAME = Object.fromEntries(CREATORS.map((c) => [c.key, c.name]));
const NAME_TO_KEY = Object.fromEntries(CREATORS.map((c) => [c.name, c.key]));

module.exports = { CREATORS, KEY_TO_NAME, NAME_TO_KEY };
