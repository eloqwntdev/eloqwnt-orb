// Fetch a public web page and turn it into plain text for Claude. Refuses private and local addresses.
import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 3_000_000;
const MAX_CHARS = 60_000;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublic(url) {
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https links work.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("That address isn’t public.");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("That website couldn’t be found.");
  if (addrs.some((a) => privateIp(a.address))) throw new Error("That address isn’t public.");
}

// Public Google Docs, Slides and Sheets links have plain exports that read far better than the editor page.
function rewrite(url) {
  const m = url.href.match(/^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/);
  if (!m) return url;
  const fmt = m[1] === "spreadsheets" ? "export?format=csv" : "export?format=txt";
  return new URL(`https://docs.google.com/${m[1]}/d/${m[2]}/${fmt}`);
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", middot: "·", copy: "©" };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

export function htmlToText(html) {
  const meta = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) meta.push("Title: " + decode(title[1]).trim());
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content=["']([^"']*)["']/i) || [])[1];
    if (name && content && /^(description|og:title|og:description|og:site_name)$/i.test(name)) meta.push(`${name}: ${decode(content)}`);
  }
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, " [image: $1] ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|footer|main|aside|li|ul|ol|tr|table|h[1-6]|blockquote|figure|figcaption|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)
    .filter((l, i, a) => l !== a[i - 1]).join("\n");
  return (meta.join("\n") + "\n\n" + text).trim();
}

export async function fetchPage(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error("That link doesn’t look right."); }
  url = rewrite(url);
  let res;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EloqwntOrbKnowledge/1.0)", Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.5" },
    }).catch(() => null);
    if (!res) throw new Error("That page didn’t respond.");
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url); continue; }
    break;
  }
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "That page is private. Make it public or upload it as a file." : `That page returned an error (${res.status}).`);
  const type = res.headers.get("content-type") || "";
  if (/application\/pdf/i.test(type)) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("That PDF is too large. Upload a smaller one.");
    return { kind: "pdf", url: url.href, data: buf.toString("base64") };
  }
  if (!/text|html|xml|json|csv/i.test(type)) throw new Error("That link isn’t a web page or PDF. Download it and upload the file instead.");
  const raw2 = (await res.text()).slice(0, MAX_BYTES);
  const text = /html|xml/i.test(type) ? htmlToText(raw2) : raw2;
  return { kind: "text", url: url.href, text: text.slice(0, MAX_CHARS), thin: text.length < 400 };
}
