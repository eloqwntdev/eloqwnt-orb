// The site's extra pages ("How we work", "Packages"), built from the knowledge base so the orb and the pages never disagree.
// A fact that is empty or [in brackets] is a gap: it never shows.
const isGap = (v) => { const s = String(v ?? "").trim(); return !s || /^\[.*\]$/.test(s); };
const filled = (n) => (n.facts || []).filter((f) => !isGap(f.v));
const fact = (n, ...keys) => { for (const k of keys) { const f = filled(n).find((x) => x.k.toLowerCase() === k.toLowerCase()); if (f) return f.v; } return ""; };
const list = (v) => String(v || "").split(/\s*(?:\n|;|•)\s*|,\s+(?=[A-Z0-9])/).map((x) => x.replace(/^[-–]\s*/, "").trim()).filter(Boolean);

export const PAGES = {
  process: { path: "/how-we-work", title: "How we work" },
  packages: { path: "/packages", title: "Packages" },
};
// Fact keys with a fixed place on the pages. The dashboard adds them as gaps so they're easy to fill.
export const PROCESS_KEYS = ["Sign-off points", "Revision rounds", "What we need from you"];
export const TERMS_ID = "working-terms";
export const TERMS_KEYS = ["Payment schedule", "Who owns the work", "Revision rounds", "After launch", "Contract", "How we keep in touch"];
export const SERVICE_KEYS = ["Best for"];

const STEP = /^(?:day|days|week|weeks|phase|step|month|months|stage)\b/i;

export function processPage(ctx) {
  const tracks = ctx.nodes.filter((n) => n.type === "process").map((n) => {
    const fs = filled(n);
    const used = new Set(PROCESS_KEYS.map((k) => k.toLowerCase()));
    return {
      id: n.id, title: n.title, summary: n.summary || "",
      steps: fs.filter((f) => STEP.test(f.k)).map((f) => ({ when: f.k, what: f.v })),
      signoff: list(fact(n, "Sign-off points")), revisions: fact(n, "Revision rounds"), needs: list(fact(n, "What we need from you")),
      notes: fs.filter((f) => !STEP.test(f.k) && !used.has(f.k.toLowerCase())).map((f) => ({ k: f.k, v: f.v })),
      service: (n.links || []).map((l) => ctx.byId.get(l)).find((x) => x && x.type === "service")?.id || "",
    };
  }).filter((t) => t.steps.length);
  const terms = ctx.byId.get(TERMS_ID);
  return { kind: "process", title: PAGES.process.title, tracks, terms: terms ? filled(terms).map((f) => ({ k: f.k, v: f.v })) : [] };
}

export function packagesPage(ctx) {
  const procBy = new Map();
  ctx.nodes.filter((n) => n.type === "process").forEach((p) => (p.links || []).forEach((l) => procBy.set(l, p.id)));
  const SKIP = ["price", "prices", "starting price", "timeline", "included", "scope", "what each package includes", "best for"];
  const packages = ctx.nodes.filter((n) => n.type === "service").map((n) => ({
    id: n.id, title: n.title, summary: n.summary || "",
    price: fact(n, "Price", "Starting price", "Prices"), timeline: fact(n, "Timeline"),
    included: list(fact(n, "Included", "What each package includes", "Scope")), bestFor: fact(n, "Best for"),
    more: filled(n).filter((f) => !SKIP.includes(f.k.toLowerCase())).map((f) => ({ k: f.k, v: f.v })),
    process: procBy.get(n.id) || (n.links || []).find((l) => ctx.byId.get(l)?.type === "process") || "",
  })).filter((p) => p.price || p.included.length);
  const pricing = ctx.nodes.find((n) => n.type === "policy" && fact(n, "What raises the price"));
  return { kind: "packages", title: PAGES.packages.title, packages, changes: pricing ? list(fact(pricing, "What raises the price")) : [] };
}

/** One line per page for the orb, so it knows what each page shows. */
export function pagesForOrb(ctx) {
  const p = processPage(ctx), k = packagesPage(ctx);
  const out = [];
  if (p.tracks.length) out.push(`- "process" (How we work): the steps and timeline for ${p.tracks.map((t) => t.title).join(", ")}${p.terms.length ? ", plus working terms (" + p.terms.map((t) => t.k.toLowerCase()).join(", ") + ")" : ""}.`);
  if (k.packages.length) out.push(`- "packages" (Packages): ${k.packages.map((x) => x.title + (x.price ? " " + x.price : "")).join("; ")}, what each includes and its timeline.`);
  return out.join("\n");
}
