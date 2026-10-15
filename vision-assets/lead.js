// Chat with the orb, asking the name, the brief preview and the email form.
// Works next to the voice orb in index.html through window.EV, and exposes window.EVLead for the voice agent.
(() => {
  "use strict";
  const EV = window.EV;
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $("#root");
  const CAL = "https://calendly.com/eloqwnt/discovery-call";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rich = (t) => esc(t).replace(/&lt;m&gt;([\s\S]*?)&lt;\/m&gt;/g, '<span class="m">$1</span>').replace(/&lt;\/?m&gt;/g, "");
  const svg = (d, w = 1.6) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const I = {
    arrow: "M4 10h12M11 5l5 5-5 5", x: "M5 5l10 10M15 5L5 15", lock: "M5.5 9h9v7.5h-9zM7.2 9V6.8a2.8 2.8 0 0 1 5.6 0V9",
    mail: "M3 5.5h14v10H3zM3.5 6l6.5 5 6.5-5", cal: "M3.5 5h13v11h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5", check: "M4.5 10.5l3.5 3.5 7.5-8.5", ext: "M8 4H4v12h12v-4M11 4h5v5M16 4l-7 7",
  };
  const QUESTIONS = ["", "Can you show me your recent work?", "I'd like to discuss a new project with you.", "What services do you offer?", "How does working with you look?"];

  const store = {
    get(k, d, s = localStorage) { try { const v = s.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  /* ---------- where the visitor came from (first touch) ---------- */
  const SRC_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
  function source() {
    const q = new URLSearchParams(location.search);
    let s = store.get("ev-src", null);
    const fresh = SRC_KEYS.some((k) => q.get(k));
    if (!s || (fresh && !SRC_KEYS.some((k) => s[k]))) {
      s = {};
      SRC_KEYS.forEach((k) => { if (q.get(k)) s[k] = q.get(k).slice(0, 200); });
      try { if (document.referrer && new URL(document.referrer).host !== location.host) s.referrer = document.referrer.slice(0, 300); } catch { /* ignore */ }
      s.landing = (location.pathname + location.search).slice(0, 300);
      s.firstSeen = new Date().toISOString();
      store.set("ev-src", s);
    }
    return s;
  }
  source();

  /* ---------- state ---------- */
  const saved = store.get("ev-chat", null, sessionStorage) || {};
  const chat = {
    convId: saved.convId || null, msgs: saved.msgs || [], askedName: !!saved.askedName, offeredBrief: !!saved.offeredBrief,
    busy: false, nameBox: false,
  };
  let name = store.get("ev-name", "") || "";
  const persist = () => store.set("ev-chat", { convId: chat.convId, msgs: chat.msgs.slice(-60), askedName: chat.askedName, offeredBrief: chat.offeredBrief }, sessionStorage);
  const userTurns = () => chat.msgs.filter((m) => m.role === "user" && !m.kind).length;
  const voiceTurns = () => (EV.voiceLog || []).filter((m) => m.role === "user").length;

  /* ---------- mode: voice or chat ---------- */
  const tog = $("#modeTog");
  function setMode(m, opts = {}) {
    app.dataset.mode = m;
    $$("button", tog).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    store.set("ev-mode", m);
    if (m === "chat") {
      if (EV.live && EV.live.active) EV.live.stop();
      if (app.dataset.view === "results") { app.dataset.view = "voice"; scrollTo(0, 0); }
      if (EV.state() !== "idle") EV.setState("idle");
      if (chat.msgs.length && !opts.stage) showChat();
      else if (!opts.silent) setTimeout(() => $("#cIn0").focus({ preventScroll: true }), 60);
    } else if (app.dataset.view === "chat") {
      app.dataset.view = "voice"; scrollTo(0, 0); EV.setState("idle");
    }
  }
  tog.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.mode); });
  setMode(store.get("ev-mode", "voice") === "chat" ? "chat" : "voice", { silent: true, stage: true });

  // In chat mode the orb still talks: clicking it switches to voice and starts.
  $("#orb").addEventListener("click", (e) => {
    // A muted call: the orb unmutes instead of ending the call.
    if (EV.live && EV.live.active && EV.live.muted) { e.stopImmediatePropagation(); EV.live.mute(false); return; }
    if (app.dataset.mode === "chat") setMode("voice");
  }, true);
  // The logo goes back to the start screen; the chat stays.
  $("#home").addEventListener("click", (e) => { if (app.dataset.view === "chat") { e.preventDefault(); e.stopImmediatePropagation(); app.dataset.view = "voice"; EV.setState("idle"); scrollTo(0, 0); } }, true);

  /* ---------- composers ---------- */
  $$("[data-composer]").forEach((form) => {
    const ta = $("textarea", form), send = $(".c-send", form);
    const fit = () => {
      send.disabled = !ta.value.trim() || chat.busy;
      if (!ta.value || !ta.offsetParent) { ta.style.height = ""; return; } // empty or hidden: one line
      ta.style.height = "auto"; ta.style.height = Math.min(Math.max(ta.scrollHeight, 44), 144) + "px";
    };
    ta.addEventListener("input", fit);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = ta.value.trim();
      if (!v || chat.busy) return;
      ta.value = ""; fit();
      sendText(v);
    });
    $("[data-tovoice]", form).addEventListener("click", () => { setMode("voice"); if (EV.live && !EV.live.active) EV.live.start(); });
    form._fit = fit;
  });
  if (matchMedia("(max-width:640px)").matches) $("#cIn0").placeholder = "Type your question";
  const refreshComposers = () => $$("[data-composer]").forEach((f) => f._fit && f._fit());
  $$("#cstart .chip").forEach((c) => c.addEventListener("click", () => sendText(QUESTIONS[+c.dataset.q] || c.textContent)));

  /* ---------- the thread ---------- */
  const thread = $("#thread");
  function caseImage(title) {
    const t = String(title || "").toLowerCase();
    const hit = (EV.cases || []).find((c) => c.n.toLowerCase() === t || t.includes(c.n.toLowerCase()) || c.n.toLowerCase().includes(t));
    return hit ? hit.img : "";
  }
  function caseHTML(c) {
    const img = caseImage(c.title);
    const inner = `<span class="img">${img ? `<img src="${img}" alt="">` : ""}</span><span class="tx"><span class="ctag">${esc(c.tag)}</span><b>${esc(c.title)}</b>${c.result ? `<span class="res"><i></i>${esc(c.result)}</span>` : ""}${c.link ? `<span class="lnk">See the case ${svg(I.arrow)}</span>` : ""}</span>`;
    return c.link ? `<a class="ccase cmsg" href="${esc(c.link)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="ccase cmsg">${inner}</div>`;
  }
  function render() {
    const last = chat.msgs.length - 1;
    thread.innerHTML = chat.msgs.map((m, i) => {
      if (m.role === "user") return m.kind === "skip" ? "" : `<div class="cmsg me">${esc(m.text)}</div>`;
      let h = `<div class="cmsg orb${m.err ? " err" : ""}"><img class="av" src="/kb-assets/orb-logo.png" alt=""><p>${rich(m.text)}</p></div>`;
      if (m.case) h += caseHTML(m.case);
      if (m.offerBrief) h += `<div class="cact cmsg"><button class="btnp" type="button" data-brief>Get my brief ${svg(I.arrow)}</button><span class="note">A plan, starting prices and matching work</span></div>`;
      if (m.bookCall) h += `<div class="cact cmsg"><a class="btnp" href="${CAL}" target="_blank" rel="noopener">${svg(I.cal)}Open the calendar</a></div>`;
      if (m.err && i === last) h += `<div class="cact cmsg"><button class="btng" type="button" data-retry>Try again</button></div>`;
      return h;
    }).join("") + (chat.nameBox ? `<form class="namebox" id="nameBox" autocomplete="on"><input name="given-name" autocomplete="given-name" placeholder="Your first name" aria-label="Your first name" maxlength="60"><button class="skip" type="button" data-skip>Skip</button><button class="c-send" type="submit" aria-label="Save name" disabled>${svg(I.arrow, 1.8)}</button></form>` : "")
      + (chat.busy ? `<div class="cmsg orb"><img class="av" src="/kb-assets/orb-logo.png" alt=""><p><span class="typing" aria-label="Typing"><i></i><i></i><i></i></span></p></div>` : "");
    const lastMsg = chat.msgs[chat.msgs.length - 1];
    $("#briefTop").hidden = !(userTurns() >= 3 || chat.offeredBrief) || chat.busy || !!(lastMsg && lastMsg.offerBrief); // not twice next to the inline button
    bindThread();
    requestAnimationFrame(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" }));
  }
  function bindThread() {
    $$("[data-brief]", thread).forEach((b) => b.onclick = () => openBrief("chat"));
    $$("[data-retry]", thread).forEach((b) => b.onclick = retry);
    const nb = $("#nameBox");
    if (nb) {
      const inp = $("input", nb), go = $(".c-send", nb);
      inp.oninput = () => { go.disabled = !inp.value.trim(); };
      nb.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) giveName(v); };
      $("[data-skip]", nb).onclick = () => { chat.nameBox = false; chat.askedName = true; persist(); render(); focusDock(); };
      if (!matchMedia("(max-width:760px)").matches) setTimeout(() => inp.focus({ preventScroll: true }), 80);
    }
  }
  function showChat() {
    app.dataset.view = "chat";
    render();
    focusDock();
  }
  const focusDock = () => { if (!matchMedia("(max-width:760px)").matches) setTimeout(() => $("#cdock textarea").focus({ preventScroll: true }), 60); };

  /* ---------- talking to /api/chat ---------- */
  let lastReq = null;
  // "yes" / "brief" right after the orb offered the brief: open it instead of asking the orb again.
  const BRIEF_YES = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|please|go|let'?s do it|sounds good|да|давай|ок|хочу)\b|\bbrief\b|бриф/i;
  async function sendText(text, kind) {
    if (app.dataset.mode !== "chat") setMode("chat", { stage: true });
    const lastOrb = [...chat.msgs].reverse().find((m) => m.role === "orb" && !m.err);
    const asksBrief = !kind && userTurns() >= 2 && (/\bbrief\b|бриф/i.test(text) || (lastOrb && lastOrb.offerBrief && BRIEF_YES.test(text.trim())));
    if (asksBrief && text.length < 80) {
      chat.nameBox = false;
      chat.msgs.push({ role: "user", text }, { role: "orb", text: "Here it is. It takes a few seconds to put together.", offerBrief: true });
      chat.offeredBrief = true;
      persist(); app.dataset.view = "chat"; render();
      openBrief("chat");
      return;
    }
    chat.nameBox = false;
    chat.msgs = chat.msgs.filter((m) => !m.err);
    chat.msgs.push(kind ? { role: "user", text, kind } : { role: "user", text });
    persist();
    if (app.dataset.view !== "chat") app.dataset.view = "chat";
    await ask({ text, kind });
  }
  function giveName(v) {
    name = v.replace(/^(?:i'?m|it'?s|my name is|call me)\s+/i, "").replace(/[.!]+$/, "").slice(0, 60);
    store.set("ev-name", name);
    sendText(name, "name");
  }
  async function ask(req) {
    lastReq = req;
    chat.busy = true; render(); refreshComposers();
    $("#cerr").textContent = "";
    try {
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          convId: chat.convId, text: req.text, kind: req.kind || "text", source: source(), name,
          history: chat.msgs.slice(0, -1).filter((m) => !m.err).map((m) => ({ role: m.role, text: m.text })), askedName: chat.askedName, offeredBrief: chat.offeredBrief,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "The orb didn’t answer.");
      chat.convId = d.convId || chat.convId;
      if (d.askName) { chat.askedName = true; if (!name) chat.nameBox = true; }
      if (d.offerBrief) chat.offeredBrief = true;
      if (d.name && !name) { name = d.name; store.set("ev-name", name); }
      chat.msgs.push({ role: "orb", text: d.reply, case: d.case || null, offerBrief: !!d.offerBrief, bookCall: !!d.bookCall });
    } catch (e) {
      chat.msgs.push({ role: "orb", text: e.message || "The orb didn’t answer.", err: true });
    }
    chat.busy = false;
    // A safety net: ask once for the name if the orb hasn't after a few messages.
    if (!name && !chat.askedName && userTurns() >= 4 && !chat.msgs[chat.msgs.length - 1].err) {
      chat.askedName = true; chat.nameBox = true;
      chat.msgs.push({ role: "orb", text: "One quick thing before we go on: <m>what should I call you?</m>" });
    }
    persist(); render(); refreshComposers();
  }
  function retry() {
    chat.msgs = chat.msgs.filter((m) => !m.err);
    if (lastReq) ask(lastReq);
  }

  if (chat.msgs.length && app.dataset.mode === "chat") { chat.msgs = chat.msgs.filter((m) => !m.err); render(); }

  /* ---------- the brief ---------- */
  const scrim = document.createElement("div"); scrim.className = "bscrim"; scrim.hidden = true;
  const sheet = document.createElement("section");
  sheet.className = "bsheet"; sheet.hidden = true;
  sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Your brief");
  app.append(scrim, sheet);
  let brief = null, briefMode = "chat", lastFocus = null, stepTimer = null;

  function openBrief(mode) {
    briefMode = mode === "voice" ? "voice" : "chat";
    if (briefMode === "voice" && EV.live && EV.live.active) { /* keep the call going; the sheet sits on top */ }
    lastFocus = document.activeElement;
    scrim.hidden = sheet.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add("on"); sheet.classList.add("on"); });
    document.documentElement.style.overflow = "hidden";
    if (brief && brief.sent) return step("sent");
    if (brief && brief.mode === briefMode && brief.turns === turnsNow()) return step(matchMedia("(max-width:760px)").matches ? "preview" : "preview");
    makeBrief();
  }
  const turnsNow = () => (briefMode === "voice" ? voiceTurns() : userTurns());
  function closeBrief() {
    scrim.classList.remove("on"); sheet.classList.remove("on");
    clearInterval(stepTimer);
    document.documentElement.style.overflow = "";
    setTimeout(() => { scrim.hidden = sheet.hidden = true; }, reduce ? 0 : 380);
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
  }
  scrim.addEventListener("click", closeBrief);
  document.addEventListener("keydown", (e) => {
    if (sheet.hidden) return;
    if (e.key === "Escape") { e.stopPropagation(); closeBrief(); }
    if (e.key === "Tab") { // keep focus inside the sheet
      const f = $$("button,a[href],input:not([type=hidden]):not(.hp),textarea", sheet).filter((x) => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }, true);

  const X = `<button class="c-ic x" type="button" data-close aria-label="Close">${svg(I.x)}</button>`;
  function step(s, extra) {
    sheet.dataset.step = s;
    clearInterval(stepTimer);
    if (s === "loading") {
      sheet.innerHTML = `<div class="handle"></div>${X}<div class="bstate bload"><img class="orbimg" src="/kb-assets/orb-loop-${app.classList.contains("is-dark") ? "dark" : "light"}.webp" alt=""><h3>Writing your brief</h3><div class="bsteps">${["Reading our conversation", "Matching our work", "Drafting a plan"].map((t, i) => `<span class="${i ? "" : "on"}"><i></i>${t}</span>`).join("")}</div></div>`;
      let k = 0; stepTimer = setInterval(() => { const sp = $$(".bsteps span", sheet); k = Math.min(k + 1, sp.length - 1); sp[k].classList.add("on"); }, 2200);
    } else if (s === "error") {
      sheet.innerHTML = `<div class="handle"></div>${X}<div class="bstate berr"><h3>Not quite yet</h3><p>${esc(extra || "The brief didn’t come together. Try again.")}</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${extra && /first/.test(extra) ? `<button class="btnp" type="button" data-close>Keep talking</button>` : `<button class="btnp" type="button" data-again>Try again</button><button class="btng" type="button" data-close>Close</button>`}</div></div>`;
    } else if (s === "preview" || s === "form") {
      if (!sheet.querySelector(".bprev")) sheet.innerHTML = `<div class="handle"></div>${X}${previewHTML()}${formHTML()}`;
      if (s === "form") setTimeout(() => $(`#bf-${name ? "email" : "name"}`, sheet)?.focus(), 60);
      else if (!matchMedia("(max-width:760px)").matches) setTimeout(() => $(`#bf-${name ? "email" : "name"}`, sheet)?.focus(), 60);
    } else if (s === "sent") {
      sheet.innerHTML = `<div class="handle"></div>${X}${sentHTML()}`;
    }
    bindSheet();
  }
  function bindSheet() {
    $$("[data-close]", sheet).forEach((b) => b.onclick = () => { closeBrief(); if (b.dataset.close === "talk") keepTalking(); });
    $$("[data-again]", sheet).forEach((b) => b.onclick = makeBrief);
    $$("[data-toform]", sheet).forEach((b) => b.onclick = () => step("form"));
    $$("[data-resend]", sheet).forEach((b) => b.onclick = resend);
    const f = $("form", sheet);
    if (f) f.onsubmit = submitLead;
    // fade the bottom edge of a column while there is more to scroll
    $$(".bprev,.bform", sheet).forEach((col) => {
      const edge = () => col.classList.toggle("more", col.scrollHeight - col.scrollTop - col.clientHeight > 8);
      col.onscroll = edge; requestAnimationFrame(edge);
    });
  }
  function keepTalking() {
    if (briefMode === "chat") { setMode("chat"); showChat(); }
  }

  async function makeBrief() {
    step("loading");
    const turns = turnsNow();
    try {
      const body = briefMode === "voice"
        ? { mode: "voice", messages: EV.voiceLog || [], name, source: source() }
        : { mode: "chat", convId: chat.convId, messages: chat.msgs.filter((m) => !m.err && !m.kind).map((m) => ({ role: m.role, text: m.text })), name, source: source() };
      const r = await fetch("/api/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "The brief didn’t come together. Try again.");
      brief = { id: d.briefId, p: d.preview, mode: briefMode, turns };
      if (sheet.hidden) return;
      sheet.innerHTML = "";
      step("preview");
    } catch (e) {
      if (!sheet.hidden) step("error", e.message);
    }
  }

  function previewHTML() {
    const p = brief.p;
    const who = [p.company ? `Brief for ${esc(p.company)}` : "Your brief", name || p.name ? `prepared for ${esc(name || p.name)}` : "", new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })].filter(Boolean).join(" · ");
    return `<div class="bprev">
      <div class="bp-meta"><img src="/kb-assets/orb-logo.png" alt="">${who}</div>
      <h2 class="bp-h">${esc(p.headline)}</h2>
      ${p.told?.length ? `<div class="bsec"><h4>What you told us</h4><ul>${p.told.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      ${p.approach ? `<div class="bsec"><h4>How we’d approach it</h4><p>${esc(p.approach)}</p></div>` : ""}
      ${p.freebie ? `<div class="bsec freebie"><h4>A quick win for this week</h4><p>${esc(p.freebie)}</p></div>` : ""}
      <div class="blocked"><div class="blur" aria-hidden="true"><div class="bsec"><h4>Plan and timeline</h4><p>${esc(p.teaser || "Phase 1 and phase 2 with weeks and deliverables.")}</p></div></div><div class="fade"></div>
        <div class="lockcard"><b>${svg(I.lock)}In the full brief</b><ul>${(p.locked || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
      <div class="bmcta"><button class="btnp wide" type="button" data-toform>Email me the full brief ${svg(I.arrow)}</button><span class="fine" style="text-align:center">Free. Plan, prices, quick wins and more.</span></div>
    </div>`;
  }
  function formHTML() {
    const p = brief.p;
    return `<div class="bform"><form novalidate>
      <div><h3>Get the full brief by email</h3><p class="fine" style="font-size:15px">Plan and prices, quick wins for this week, and questions to ask any agency. Free, no call required.</p></div>
      <div class="fld"><label for="bf-name">Name</label><input id="bf-name" name="name" autocomplete="name" value="${esc(name || p.name || "")}" maxlength="80"></div>
      <div class="fld"><label for="bf-email">Work email</label><input id="bf-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@company.com" required maxlength="200"></div>
      <div class="fld"><label for="bf-company">Company <span class="opt">· optional</span></label><input id="bf-company" name="company" autocomplete="organization" value="${esc(p.company || "")}" maxlength="120"></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="chk"><input type="checkbox" name="consent" checked><span>Send me this brief. Eloqwnt may follow up once about it.</span></label>
      <label class="chk"><input type="checkbox" name="newsletter"><span>Also send occasional notes on brand and launches. Unsubscribe anytime.</span></label>
      <p class="ferr" id="bf-err" role="alert"></p>
      <button class="btnp wide" type="submit">Send my full brief ${svg(I.arrow)}</button>
      <a class="btng wide" href="${CAL}" target="_blank" rel="noopener">${svg(I.cal, 1.5)}Or book a 20-minute call</a>
      <p class="fine" style="text-align:center">We use your email only for this brief and follow-up.</p>
    </form></div>`;
  }
  function sentHTML() {
    const first = esc((brief.name || name || "").split(/\s+/)[0]);
    const open = `<a class="btng wide" href="${esc(brief.url)}" target="_blank" rel="noopener">${svg(I.ext, 1.5)}Open the brief now</a>`;
    return `<div class="bstate bsent">
      <span class="okmark">${svg(I.check, 2)}</span>
      ${brief.emailed
        ? `<h3>On its way${first ? ", " + first : ""}</h3><p>The full brief usually lands within a minute. If you don’t see it, check Promotions or Spam.</p>
           <div class="sendline">${svg(I.mail, 1.5)}<span>${esc(brief.email)}</span><button type="button" data-resend>Resend</button></div>${open}`
        : `<h3>Your brief is ready${first ? ", " + first : ""}</h3><p>Open it below. We’ll also follow up at ${esc(brief.email)}.</p>${open.replace("btng", "btnp")}`}
      <div class="hr"></div>
      <p style="color:var(--ink-2)">Want to talk it through while it’s fresh?</p>
      <a class="btnp wide" href="${CAL}" target="_blank" rel="noopener">${svg(I.cal, 1.6)}Book a 20-minute call</a>
      <button class="btng wide" type="button" data-close="talk">Keep talking to the orb</button>
    </div>`;
  }

  async function submitLead(e) {
    e.preventDefault();
    const f = e.currentTarget, err = $("#bf-err", sheet), btn = $("button[type=submit]", f);
    const v = (n) => f.elements[n];
    $$("input", f).forEach((i) => i.removeAttribute("aria-invalid"));
    err.textContent = "";
    const email = v("email").value.trim();
    if (!/^\S+@\S+\.\S{2,}$/.test(email)) { v("email").setAttribute("aria-invalid", "true"); err.textContent = "Add your email so we can send the brief."; v("email").focus(); return; }
    if (!v("consent").checked) { err.textContent = "Tick the first box so we can send the brief."; return; }
    btn.disabled = true; btn.firstChild.textContent = "Sending… ";
    try {
      const r = await fetch("/api/lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefId: brief.id, name: v("name").value.trim(), email, company: v("company").value.trim(), consent: v("consent").checked, newsletter: v("newsletter").checked, website: v("website").value, source: source(), mode: briefMode }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { if (d.field && v(d.field)) { v(d.field).setAttribute("aria-invalid", "true"); v(d.field).focus(); } throw new Error(d.error || "That didn’t go through. Try again."); }
      const nm = v("name").value.trim();
      if (nm && !name) { name = nm.split(/\s+/)[0]; store.set("ev-name", name); }
      Object.assign(brief, { sent: true, emailed: !!d.emailed, url: d.briefUrl, email, name: nm || name });
      step("sent");
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false; btn.firstChild.textContent = "Send my full brief ";
    }
  }
  async function resend(e) {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Sending…";
    try {
      const r = await fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ briefId: brief.id, resend: true }) });
      const d = await r.json().catch(() => ({}));
      b.textContent = r.ok && d.emailed ? "Sent again" : "Couldn’t resend";
    } catch { b.textContent = "Couldn’t resend"; }
  }

  $("#briefTop").addEventListener("click", () => openBrief("chat"));

  /* ---------- voice: the agent can save the name and open the brief ---------- */
  function voiceNudge() {
    const ok = voiceTurns() >= 2;
    const prompts = $(".foot .prompts");
    let chip = $(".briefchip", prompts);
    if (ok && !chip) {
      chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip briefchip"; chip.innerHTML = "<i></i>Get a brief from our talk";
      chip.addEventListener("click", (e) => { e.stopImmediatePropagation(); openBrief("voice"); }, true);
      prompts.prepend(chip);
    }
    $("#briefLinkWrap").hidden = !(ok || userTurns() >= 2);
  }
  $("#briefLink").addEventListener("click", (e) => { e.preventDefault(); openBrief(voiceTurns() >= userTurns() ? "voice" : "chat"); });
  new MutationObserver(() => { if (app.dataset.view === "results") { voiceNudge(); relatedWork(); } }).observe(app, { attributes: true, attributeFilter: ["data-view"] });

  /* ---------- related work: the cases the orb talked about first, then the closest matches ---------- */
  let kbCases = null;
  const loadCases = () => kbCases || (kbCases = fetch("/api/cases").then((r) => r.json()).then((d) => d.cases || []).catch(() => []));
  loadCases();
  const norm = (t) => String(t || "").toLowerCase();
  const words = (t) => new Set(norm(t).match(/[a-z]{4,}/g) || []);
  // Does the visitor's side of the talk say anything about their project yet?
  const PROJECT = /\b(brand|branding|logo|site|website|web|landing|page|app|startup|company|business|launch|product|store|shop|e-?commerce|fintech|health|clinic|saas|platform|redesign|rebrand|identity|video|investors?|raise|series|customers?|sell|selling|jewel\w*|fashion|label)\b/i;
  const hasContext = () => [...(EV.voiceLog || []), ...chat.msgs].some((m) => m.role === "user" && !m.kind && PROJECT.test(m.text || ""));
  const ctaLabel = () => {
    const cta = $("#cta"); if (!cta) return;
    const t = [...cta.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const want = hasContext() ? "Show relevant work " : "Show our work ";
    if (t && t.textContent !== want) t.textContent = want;
  };
  new MutationObserver(ctaLabel).observe($("#cta"), { attributes: true, attributeFilter: ["class"] });
  ctaLabel();

  async function relatedWork() {
    const ctx = hasContext();
    $("#workTitle").textContent = ctx ? "Related work" : "Our work";
    const chip = $("#workTitle").closest(".sec-head")?.querySelector(".sec-right .ai");
    if (chip && chip.lastChild) chip.lastChild.textContent = ctx ? "Based on your question" : "Recent launches";
    const kb = await loadCases();
    const statics = EV.cases || [];
    const talk = [...(EV.voiceLog || []), ...chat.msgs.filter((m) => !m.err)];
    const orbText = norm(talk.filter((m) => m.role === "orb").map((m) => m.text).join(" "));
    const userWords = words(talk.filter((m) => m.role === "user").map((m) => m.text).join(" "));
    const seen = new Set();
    const items = [];
    const add = (title, extra) => {
      const key = norm(title).replace(/[^a-z0-9]/g, "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      const st = statics.find((c) => norm(c.n).replace(/[^a-z0-9]/g, "") === key);
      const desc = (st && st.d) || extra?.result || "";
      const tagsText = (st ? st.t.join(" ") : "") + " " + (extra?.tag || "");
      let score = 0;
      if (orbText.includes(norm(title))) score += 100;
      for (const w of words(desc + " " + tagsText)) if (userWords.has(w)) score += 3;
      items.push({ title, img: st?.img || "", year: st?.y || "", desc, tags: st ? st.t : String(extra?.tag || "").split(" · ").filter((t) => t && t !== "Case"), link: extra?.link || "", mentioned: score >= 100, score, order: items.length });
    };
    kb.forEach((c) => add(c.title, c));
    statics.forEach((c) => add(c.n, null));
    items.sort((a, b) => b.score - a.score || (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.order - b.order);
    const top = items.slice(0, 10);
    if (!top.length) return;
    const ARROW = svg(I.arrow);
    const card = (c) => {
      const pv = c.img ? `<img src="${c.img}" alt="${esc(c.title)} preview" loading="lazy">` : `<span class="pv-ph">${esc(c.title)}</span>`;
      const tags = (c.mentioned ? `<span class="tag mention">Mentioned</span>` : "") + c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      const attrs = c.link ? `href="${esc(c.link)}" target="_blank" rel="noopener"` : `href="#" onclick="return false"`;
      return `<a class="case${c.mentioned ? " is-mentioned" : ""}" ${attrs}><span class="pv">${pv}${c.mentioned ? `<span class="pv-badge"><i></i>Mentioned</span>` : ""}</span><span class="tx"><span class="mt"><span>${esc(c.title)}</span><span>${esc(c.year)}</span></span><span class="desc">${esc(c.desc)}</span><span class="tags">${tags}</span></span><span class="vc">View case ${ARROW}</span></a>`;
    };
    $("#cases").innerHTML = top.slice(0, 6).map(card).join("");
    const rest = top.slice(6);
    $("#cases2").innerHTML = rest.map(card).join("");
    $("#caseCount").textContent = `${top.length} project${top.length === 1 ? "" : "s"}`;
    const mb = $("#moreBtn"); const row = mb.closest(".more-btn-row");
    row.hidden = !rest.length;
    mb.dataset.label = `Show ${rest.length} more`;
    if (mb.getAttribute("aria-expanded") !== "true") mb.querySelector("span").textContent = mb.dataset.label;
    const lbl = $("#moreInner .divider .ai"); if (lbl && lbl.lastChild) lbl.lastChild.textContent = `${rest.length} more, ranked by relevance`;
  }

  /* ---------- voice stage: long questions and answers shrink the orb instead of falling off the screen ---------- */
  const stageEl = $(".stage"), headEl = $(".head"), footEl = $(".foot"), orbBox = $("#orb");
  let fitQueued = false;
  function fitStage() {
    fitQueued = false;
    headEl.style.minHeight = ""; footEl.style.height = ""; stageEl.style.removeProperty("--orb"); stageEl.classList.remove("orb-small");
    if (app.dataset.view !== "voice" || app.dataset.mode === "chat") return;
    const hOn = $(".head > div.on"), fOn = $(".foot > div.on");
    const hh = Math.max(headEl.offsetHeight, hOn ? hOn.scrollHeight : 0);
    const fh = Math.max(footEl.offsetHeight, fOn ? fOn.scrollHeight + 8 : 0);
    if (hh > headEl.offsetHeight) headEl.style.minHeight = hh + "px";
    if (fh > footEl.offsetHeight) footEl.style.height = fh + "px";
    const top = parseFloat(getComputedStyle(stageEl).paddingTop) || 0;
    const free = innerHeight - top - hh - 12 - fh - 24;
    const def = orbBox.offsetWidth;
    if (free < def) stageEl.style.setProperty("--orb", Math.max(120, Math.floor(free)) + "px");
    stageEl.classList.toggle("orb-small", Math.min(def, free) < 200);
  }
  const queueFit = () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(fitStage); } };
  new MutationObserver(queueFit).observe(app, { attributes: true, attributeFilter: ["data-state", "data-view", "data-mode"] });
  ["#answer", "#qHead", "#transcript"].forEach((sel) => { const el = $(sel); el && new MutationObserver(queueFit).observe(el, { childList: true, subtree: true, characterData: true }); });
  addEventListener("resize", queueFit);
  queueFit();

  window.EVLead = {
    setName(n) { name = String(n).trim().slice(0, 60); store.set("ev-name", name); },
    openBrief,
    voiceEnded: voiceNudge,
    setMode,
  };
})();
