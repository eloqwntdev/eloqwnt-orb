// The site's extra pages ("How we work", "Packages"). They open as a layer over the conversation, so the orb keeps
// talking (voice) or waits (chat) underneath. Real URLs (/how-we-work, /packages) so they can be shared and linked
// from emails and ads. Content comes from /api/page, which reads the knowledge base.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const EV = window.EV || {};
  const app = $("#root");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const svg = (d, w = 1.6) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const I = {
    back: "M16 10H4M9 5l-5 5 5 5", arrow: "M4 10h12M11 5l5 5-5 5", cal: "M3.5 5h13v11h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5", check: "M4.5 10.5l3.5 3.5 7.5-8.5",
    sign: "M4 15.5h12M5.5 12.5l6.8-6.8 2 2-6.8 6.8H5.5z", flow: "M4 5h4v4H4zM12 11h4v4h-4zM8 7h3a2 2 0 0 1 2 2v2", box: "M3.5 6.5L10 3l6.5 3.5v7L10 17l-6.5-3.5zM3.5 6.5L10 10l6.5-3.5M10 10v7",
  };
  const PAGES = {
    process: { path: "/how-we-work", title: "How we work", sub: "Steps, timeline, sign-offs and terms", icon: I.flow },
    packages: { path: "/packages", title: "Packages", sub: "What’s included, prices and timelines", icon: I.box },
  };
  const byPath = (p) => Object.keys(PAGES).find((k) => PAGES[k].path === p.replace(/\/+$/, ""));
  const cache = {};
  const load = (k) => cache[k] || (cache[k] = fetch("/api/page?p=" + k).then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => { delete cache[k]; return null; }));

  /* ---------- what the visitor said, to pick the right track or package ---------- */
  const talk = () => {
    let chatMsgs = [];
    try { chatMsgs = (JSON.parse(sessionStorage.getItem("ev-chat") || "{}").msgs) || []; } catch { /* private mode */ }
    return [...(EV.voiceLog || []), ...chatMsgs].filter((m) => m.role === "user").map((m) => m.text || "").join(" ").toLowerCase();
  };
  const KIND = [["landing", /\blanding|one[- ]page/], ["website", /\b(web)?site\b|pages\b|webflow|next\.?js/], ["brand", /\bbrand|logo|identity|rebrand/], ["video", /\bvideo|motion|film|animation/], ["content", /\bcontent|creator|social|ugc/], ["retainer", /\bretainer|ongoing|monthly/]];
  function bestMatch(items) {
    const t = talk(); if (!t) return "";
    let best = "", score = 0;
    for (const it of items) {
      const name = (it.title + " " + it.id).toLowerCase();
      let s = 0;
      for (const [key, re] of KIND) if (name.includes(key) && re.test(t)) s += 2;
      if (s > score) { score = s; best = it.id; }
    }
    return best;
  }

  /* ---------- the layer ---------- */
  const layer = document.createElement("section");
  layer.className = "pg"; layer.hidden = true; layer.tabIndex = -1;
  layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true");
  app.append(layer);
  let open = "", lastFocus = null, viewedAt = 0, pushed = false;

  function show(kind, opts = {}) {
    if (!PAGES[kind]) return;
    if (!open) lastFocus = document.activeElement;
    const was = open;
    open = kind; viewedAt = Date.now();
    layer.setAttribute("aria-label", PAGES[kind].title);
    if (!opts.fromHistory) {
      const url = PAGES[kind].path + (opts.track ? "?t=" + encodeURIComponent(opts.track) : "");
      if (was) history.replaceState({ pg: kind }, "", url);
      else { history.pushState({ pg: kind }, "", url); pushed = true; }
    }
    document.title = PAGES[kind].title + " · Eloqwnt Vision";
    layer.hidden = false;
    requestAnimationFrame(() => layer.classList.add("on"));
    document.documentElement.classList.add("pg-open");
    layer.innerHTML = frame(kind, `<div class="pg-load"><i></i><i></i><i></i></div>`);
    layer.scrollTop = 0;
    bindFrame();
    window.EVLead && window.EVLead.track("page_" + kind);
    if (EV.live && EV.live.active && EV.live.context) EV.live.context(`The visitor is now looking at the "${PAGES[kind].title}" page on screen.`);
    load(kind).then((d) => {
      if (open !== kind) return;
      $(".pg-body", layer).innerHTML = d ? (kind === "process" ? processHTML(d, opts.track) : packagesHTML(d)) : `<p class="pg-empty">This page didn’t load. <button class="pg-link" type="button" data-retry>Try again</button></p>`;
      bindBody(kind, d);
      layer.focus({ preventScroll: true }); // focus moves into the page without drawing a ring on a button
    });
  }
  function hide(opts = {}) {
    if (!open) return;
    open = "";
    layer.classList.remove("on");
    document.documentElement.classList.remove("pg-open");
    document.title = "Eloqwnt Vision";
    setTimeout(() => { if (!open) { layer.hidden = true; layer.innerHTML = ""; } }, reduce ? 0 : 360);
    if (!opts.fromHistory) { if (pushed) { pushed = false; history.back(); } else history.replaceState(null, "", "/" + location.search.replace(/[?&]t=[^&]*/, "")); }
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
  }
  addEventListener("popstate", (e) => { const k = (e.state && e.state.pg) || byPath(location.pathname); if (k) show(k, { fromHistory: true }); else { pushed = false; hide({ fromHistory: true }); } });
  document.addEventListener("keydown", (e) => { if (open && e.key === "Escape" && (!$(".bsheet") || $(".bsheet").hidden)) { e.stopPropagation(); hide(); } }, true);

  function backToOrb() {
    hide();
    const chat = app.dataset.mode === "chat";
    if (chat) { if (app.dataset.view !== "chat" && window.EVLead) window.EVLead.setMode("chat"); setTimeout(() => ($("#cdock textarea:not([hidden])") || $("#cIn0"))?.focus({ preventScroll: true }), 380); }
  }

  const live = () => EV.live && EV.live.active;
  function frame(kind, body) {
    const p = PAGES[kind], other = kind === "process" ? "packages" : "process";
    return `<header class="pg-top">
        <button class="pg-close" type="button" data-close aria-label="Back to the conversation">${svg(I.back)}<span>Back</span></button>
        <nav class="pg-tabs" aria-label="Pages">${Object.keys(PAGES).map((k) => `<button type="button" data-go="${k}" aria-current="${k === kind ? "page" : "false"}">${PAGES[k].title}</button>`).join("")}</nav>
        <a class="pg-book" href="https://calendly.com/eloqwnt/discovery-call" target="_blank" rel="noopener">${svg(I.cal, 1.5)}<span>Book a call</span></a>
      </header>
      <div class="pg-wrap"><div class="pg-body">${body}</div>
        <footer class="pg-foot"><span>© 2026 Eloqwnt Vision</span><button class="pg-link" type="button" data-go="${other}">${PAGES[other].title} ${svg(I.arrow)}</button></footer></div>
      <button class="pg-orb${live() ? " live" : ""}" type="button" data-orb><span class="pg-orbdot"></span><span>${live() ? "The orb is listening · back to the call" : app.dataset.mode === "chat" ? "Ask the orb about this" : "Talk to the orb about this"}</span>${svg(I.arrow)}</button>`;
  }
  function bindFrame() {
    $$("[data-close]", layer).forEach((b) => (b.onclick = () => hide()));
    $$("[data-go]", layer).forEach((b) => (b.onclick = () => show(b.dataset.go)));
    $$("[data-orb]", layer).forEach((b) => (b.onclick = backToOrb));
  }
  function bindBody(kind, d) {
    bindFrame();
    $$("[data-retry]", layer).forEach((b) => (b.onclick = () => show(kind)));
    $$("[data-track]", layer).forEach((b) => (b.onclick = () => {
      $$("[data-track]", layer).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $$(".pg-track", layer).forEach((x) => (x.hidden = x.dataset.id !== b.dataset.track));
      history.replaceState({ pg: kind }, "", PAGES.process.path + "?t=" + encodeURIComponent(b.dataset.track));
    }));
    $$("[data-run]", layer).forEach((b) => (b.onclick = () => show("process", { track: b.dataset.run })));
  }

  /* ---------- How we work ---------- */
  function processHTML(d, want) {
    if (!d.tracks.length) return `<p class="pg-empty">Details coming soon. Ask the orb how a project would run for you.</p>`;
    const sel = d.tracks.find((t) => t.id === want || t.service === want)?.id || bestMatch(d.tracks) || d.tracks[0].id;
    const tabs = d.tracks.length > 1 ? `<div class="pg-seg" role="tablist" aria-label="Project type">${d.tracks.map((t) => `<button type="button" role="tab" data-track="${esc(t.id)}" aria-selected="${t.id === sel}">${esc(t.title.replace(/^how (an? )?/i, "").replace(/ runs$/i, ""))}</button>`).join("")}</div>` : "";
    const track = (t) => `<div class="pg-track" data-id="${esc(t.id)}" ${t.id === sel ? "" : "hidden"}>
        ${t.summary ? `<p class="pg-lead">${esc(t.summary)}</p>` : ""}
        <div class="pg-stats">
          <span><b>${t.steps.length}</b>steps</span>
          ${t.revisions ? `<span><b>${esc(t.revisions)}</b>revision rounds</span>` : ""}
          ${t.signoff.length ? `<span><b>${t.signoff.length}</b>sign-offs by you</span>` : ""}
        </div>
        <ol class="pg-steps">${t.steps.map((s, i) => `<li><span class="pg-when">${esc(s.when)}</span><span class="pg-node"><i>${i + 1}</i></span><p>${esc(s.what)}</p></li>`).join("")}</ol>
        ${t.signoff.length || t.needs.length ? `<div class="pg-two">
          ${t.signoff.length ? `<div class="pg-card"><h3>${svg(I.sign)}You sign off</h3><ul class="pg-checks">${t.signoff.map((x) => `<li>${svg(I.check, 1.8)}${esc(x)}</li>`).join("")}</ul><p class="pg-fine">Nothing moves to the next step until you approve it.</p></div>` : ""}
          ${t.needs.length ? `<div class="pg-card"><h3>What we need from you</h3><ul class="pg-dots">${t.needs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        </div>` : ""}
        ${t.notes.length ? `<dl class="pg-notes">${t.notes.map((n) => `<div><dt>${esc(n.k)}</dt><dd>${esc(n.v)}</dd></div>`).join("")}</dl>` : ""}
        ${t.service ? `<button class="pg-link" type="button" data-go="packages">What’s included and the price ${svg(I.arrow)}</button>` : ""}
      </div>`;
    return `<div class="pg-hero"><span class="pg-eyebrow">How we work</span><h1>From the first call to launch, step by step</h1></div>
      ${tabs}${d.tracks.map(track).join("")}
      ${d.terms.length ? `<section class="pg-sec"><h2>Working terms</h2><dl class="pg-terms">${d.terms.map((x) => `<div><dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd></div>`).join("")}</dl></section>` : ""}
      ${cta("Want to see how it would run for your project?")}`;
  }

  /* ---------- Packages ---------- */
  function packagesHTML(d) {
    if (!d.packages.length) return `<p class="pg-empty">Details coming soon. Ask the orb what would fit your project.</p>`;
    const fit = bestMatch(d.packages);
    const card = (p) => `<article class="pg-pack${p.id === fit ? " fit" : ""}">
        ${p.id === fit ? `<span class="pg-fit"><i></i>Fits what you told the orb</span>` : ""}
        <h3>${esc(p.title)}</h3>
        ${p.price ? `<p class="pg-price">${esc(p.price)}</p>` : ""}
        ${p.timeline ? `<span class="pg-chip">${esc(p.timeline)}</span>` : ""}
        ${p.summary ? `<p class="pg-sum">${esc(p.summary)}</p>` : ""}
        ${p.included.length ? `<ul class="pg-checks">${p.included.map((x) => `<li>${svg(I.check, 1.8)}${esc(x)}</li>`).join("")}</ul>` : ""}
        ${p.more.length ? `<dl class="pg-mini">${p.more.map((m) => `<div><dt>${esc(m.k)}</dt><dd>${esc(m.v)}</dd></div>`).join("")}</dl>` : ""}
        ${p.bestFor ? `<p class="pg-best"><span>Best for</span>${esc(p.bestFor)}</p>` : ""}
        ${p.process ? `<button class="pg-link" type="button" data-run="${esc(p.process)}">How it runs ${svg(I.arrow)}</button>` : ""}
      </article>`;
    const sorted = fit ? [...d.packages].sort((a, b) => (b.id === fit) - (a.id === fit)) : d.packages;
    return `<div class="pg-hero"><span class="pg-eyebrow">Packages</span><h1>Clear scope, a starting price and a timeline for each</h1></div>
      <div class="pg-packs">${sorted.map(card).join("")}</div>
      ${d.changes.length ? `<section class="pg-sec"><h2>What changes the price</h2><ul class="pg-dots pg-cols">${d.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="pg-fine">Every quote is fixed before we start. We confirm scope and price on the call.</p></section>` : ""}
      ${cta("Not sure which one fits?")}`;
  }

  const cta = (q) => `<section class="pg-cta"><div><h2>${esc(q)}</h2><p>A 20-minute call with the team. You leave with a scope, a timeline and a price.</p></div>
    <div class="pg-ctab"><a class="btnp" href="https://calendly.com/eloqwnt/discovery-call" target="_blank" rel="noopener">${svg(I.cal, 1.6)}Book a call</a><button class="btng" type="button" data-orb>Ask the orb first</button></div></section>`;

  /* ---------- entry points ---------- */
  // links in the results view, next to the plan and the services
  const plan = $(".plan .block-head"); if (plan) plan.insertAdjacentHTML("beforeend", `<button class="pg-inline" type="button" data-open-page="process">How we work ${svg(I.arrow)}</button>`);
  const svcHead = $$(".row2 .block-head")[1]; if (svcHead) svcHead.insertAdjacentHTML("beforeend", `<button class="pg-inline" type="button" data-open-page="packages" style="margin-left:auto">All packages ${svg(I.arrow)}</button>`);
  const foot = $(".results .footer"); if (foot) foot.insertAdjacentHTML("afterbegin", `<nav class="pg-footnav">${Object.keys(PAGES).map((k) => `<a href="${PAGES[k].path}" data-open-page="${k}">${PAGES[k].title}</a>`).join("")}</nav>`);
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-open-page]"); if (b) { e.preventDefault(); show(b.dataset.openPage); } });

  // a shared link (/how-we-work, /packages) opens the page straight away
  const first = byPath(location.pathname);
  if (first) { history.replaceState({ pg: first }, "", location.pathname + location.search); show(first, { fromHistory: true, track: new URLSearchParams(location.search).get("t") || "" }); }

  window.EVPages = {
    show, hide, pages: PAGES,
    viewing: () => open || (Date.now() - viewedAt < 3 * 60e3 ? lastSeen() : ""),
    card: (k) => PAGES[k] ? `<button class="cpage cmsg" type="button" data-open-page="${k}"><span class="ci">${svg(PAGES[k].icon, 1.5)}</span><span class="tx"><b>${PAGES[k].title}</b><span>${PAGES[k].sub}</span></span>${svg(I.arrow)}</button>` : "",
  };
  let seen = "";
  const lastSeen = () => seen;
  new MutationObserver(() => { if (open) seen = open; }).observe(layer, { attributes: true, attributeFilter: ["aria-label"] });
})();
