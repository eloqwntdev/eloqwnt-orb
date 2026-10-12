// The standard facts every case study carries, in display order. Values can stay empty.
export const CASE_FACTS = [
  "Client",
  "Sector",
  "What we did",
  "The challenge",
  "Our approach",
  "Result",
  "Timeline",
  "Built in",
  "Year",
  "Live link",
  "Client quote",
  "Best for",
];

// Older names that mean the same thing as a standard fact.
const RENAMES = { services: "What we did" };

/**
 * Give a case node the standard facts in order, keeping every value it already has.
 * Facts that aren't standard stay, after the standard ones. `sectorTitles` fills an empty Sector.
 */
export function withCaseFacts(node, sectorTitles = []) {
  if (!node || node.type !== "case") return node;
  const byKey = new Map();
  const extras = [];
  for (const f of node.facts || []) {
    const k = String(f.k || "").trim();
    if (!k) continue;
    const std = RENAMES[k.toLowerCase()] || CASE_FACTS.find((s) => s.toLowerCase() === k.toLowerCase());
    if (std) {
      if (!byKey.has(std) || (!byKey.get(std) && f.v)) byKey.set(std, String(f.v ?? ""));
    } else extras.push({ k, v: String(f.v ?? "") });
  }
  if (!byKey.get("Sector") && sectorTitles.length) byKey.set("Sector", sectorTitles.join(", "));
  const facts = CASE_FACTS.map((k) => ({ k, v: byKey.get(k) || "" })).concat(extras);
  return { ...node, facts };
}

/** True when the node already has every standard fact, in order, at the top. */
export function hasCaseFacts(node) {
  if (!node || node.type !== "case") return true;
  const keys = (node.facts || []).map((f) => f.k);
  return CASE_FACTS.every((k, i) => keys[i] === k);
}
