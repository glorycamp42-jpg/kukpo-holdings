/* Kukpo Hub · cfpcinc.com → CFPC 마스터 weekly sync.
   Runs inside a logged-in http://www.cfpcinc.com/index.php tab (loaded by the scheduled task).
   It reads the clinic's own search results (Advanced Search export + Billing search), keeps only the
   columns the CFPC viewer needs, opens kukpoholdings.com/cfpc/?sync=cfpcinc and hands the data over with
   postMessage. Nothing is changed in cfpcinc. Returns a short summary (no patient data). */
(function () {
  const HUB = "https://www.kukpoholdings.com";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = c => (c ? c.textContent.replace(/\s+/g, " ").trim() : "");
  const pad = n => String(n).padStart(2, "0");

  async function waitFor(test, ms, what) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = test(); if (v) return v; await sleep(300); }
    throw new Error("시간 초과: " + what);
  }
  function setRange(from, to) {
    const f = document.advsearchform; if (!f) throw new Error("검색 패널 없음");
    const set = (n, v) => { const el = f.querySelector(`select[name=${n}]`); if (!el) throw new Error("필드 없음 " + n); if (![...el.options].some(o => o.value === v || o.text === v)) throw new Error("값 없음 " + n + "=" + v); el.value = v; };
    set("Month", pad(from.getMonth() + 1)); set("Day", pad(from.getDate())); set("Year", String(from.getFullYear()));
    set("Month2", pad(to.getMonth() + 1)); set("Day2", pad(to.getDate())); set("Year2", String(to.getFullYear()));
    const other = f.querySelector("select[name=otherdate]"); if (other) other.value = other.options[0].value;
    const dt = f.querySelector("select[name=dateType]"); if (dt) dt.value = "studydate";
  }
  function captureOpen(fn) { let u = null; const o = window.open; window.open = x => { u = x; return null; }; try { fn(); } finally { window.open = o; } return u; }
  function captureXhr(fn, re) { let u = null; const po = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, x, ...a) { if (re.test(x)) u = x; return po.call(this, m, x, ...a); }; try { fn(); } finally { XMLHttpRequest.prototype.open = po; } return u; }
  async function getHtml(u) { const r = await fetch(u, { credentials: "include" }); if (!r.ok) throw new Error("cfpcinc 응답 " + r.status); return new DOMParser().parseFromString(await r.text(), "text/html"); }
  function table(doc, must) {
    const rows = [...doc.querySelectorAll("tr")];
    const hi = rows.findIndex(r => { const h = [...r.cells].map(txt); return must.every(m => h.includes(m)); });
    if (hi < 0) throw new Error("표 머리글을 찾지 못함: " + must.join(","));
    const head = [...rows[hi].cells].map(txt);
    return { idx: n => head.indexOf(n), rows: rows.slice(hi + 1).filter(r => r.cells.length >= head.length - 1) };
  }

  window.kpCfpcincSync = async function (opts) {
    opts = opts || {};
    if (!/cfpcinc\.com$/.test(location.hostname)) throw new Error("cfpcinc 탭에서 실행해야 합니다");
    if (/login\.php/.test(location.pathname) || !document.querySelector('a[href="logout.php"]')) return { ok: false, error: "cfpcinc 로그인 필요" };
    const days = opts.days || 365, to = new Date(), from = new Date(Date.now() - days * 864e5);

    /* 1) all exams (Advanced Search → Excel export, which is an HTML table) */
    if (typeof switchNav === "function") switchNav("li1");
    mainSearch();
    await waitFor(() => document.advsearchform && document.advsearchform.searchdob && typeof doSearch === "function", 20000, "검사 검색 패널");
    await sleep(500);
    setRange(from, to);
    const xu = captureOpen(() => doSearch("excel"));
    if (!xu) throw new Error("엑셀 주소를 만들지 못함");
    const ed = await getHtml(xu), E = table(ed, ["PID", "Name", "Study Date", "Status"]);
    const ei = ["PID", "Name", "DOI", "Doctor", "Procedure", "Location", "Study Date", "Referrer", "Status", "Lien"].map(E.idx);
    const exams = E.rows.map(r => ei.map(i => (i >= 0 ? txt(r.cells[i]) : ""))).filter(x => x[0] && /^\d{4}-\d\d-\d\d/.test(x[6]));

    /* 2) billing amounts (Billing search results page; its Excel button is broken on the server) */
    showBilling();
    await waitFor(() => !(document.advsearchform && document.advsearchform.searchdob), 20000, "빌링 패널 전환");
    await waitFor(() => document.advsearchform && typeof doLsearch === "function" && [...document.querySelectorAll("input[type=button],button")].some(b => /doLsearch/.test(b.getAttribute("onclick") || "")), 20000, "빌링 검색 패널");
    await sleep(500);
    setRange(from, to);
    const lu = captureXhr(() => doLsearch(""), /doLsearch/);
    if (!lu) throw new Error("빌링 검색 주소를 만들지 못함");
    const bd = await getHtml(lu), B = table(bd, ["PID", "Study Date", "Billed", "Balance"]);
    const bi = ["PID", "Study Date", "Procedure", "Status", "Billed", "Paid", "Adjusted", "Balance"].map(B.idx);
    const bills = B.rows.map(r => bi.map(i => (i >= 0 ? txt(r.cells[i]) : ""))).filter(x => x[0] && /^\d{4}-\d\d-\d\d/.test(x[1]));

    if (!exams.length) return { ok: false, error: "검사 0건 — 검색 조건 확인 필요" };
    const payload = { v: 1, pulled: new Date().toISOString(), range: [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)], exams, bills };
    if (opts.dry) return { ok: true, dry: true, exams: exams.length, bills: bills.length, range: payload.range };

    /* 3) hand over to the logged-in Kukpo Hub page */
    const w = window.open(HUB + "/cfpc/?sync=cfpcinc", "kp_cfpcinc_sync");
    if (!w) return { ok: false, error: "팝업이 막혔습니다" };
    const res = await new Promise(resolve => {
      const t = setTimeout(() => { window.removeEventListener("message", on); resolve({ ok: false, error: "Hub 응답 없음 (Hub에 로그인돼 있는지 확인)" }); }, 120000);
      function on(ev) {
        if (ev.origin !== HUB || !ev.data) return;
        if (ev.data.type === "cfpcinc-sync-ready") w.postMessage({ type: "cfpcinc-sync", payload }, HUB);
        if (ev.data.type === "cfpcinc-sync-done") { clearTimeout(t); window.removeEventListener("message", on); resolve(ev.data); }
      }
      window.addEventListener("message", on);
    });
    return Object.assign({ exams: exams.length, bills: bills.length, range: payload.range }, res);
  };
})();
