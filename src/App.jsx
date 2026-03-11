import { useState, useRef, useEffect, useCallback } from "react";

// Use the legacy pdfjs build — required for Safari/WebKit on iOS.
// The standard build uses modern JS (for...of on iterators, etc.) that
// iOS Safari doesn't fully support and throws "undefined is not a function".
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// ─── Colour helpers (read from CSS custom properties at runtime) ─────────────
// These are used for JS-only computations (col(), pill(), changeBadge()).
// The actual rendered colours come from CSS vars — these just mirror them.
const GREEN  = "#00c853";
const RED    = "#f5222d";
const DIM    = "#8c9bb0";
const ACCENT = "#2d7ff9";

function col(v) { return v > 0 ? GREEN : v < 0 ? RED : DIM; }

// ─── Theme tokens ─────────────────────────────────────────────────────────────
// All colours live in CSS custom properties. Toggling body.light switches theme.
const THEME_CSS = `
  /* ── Dark theme (default) ── */
  :root {
    --clr-green       : #00c853;
    --clr-red         : #f5222d;
    --clr-dim         : #8c9bb0;
    --clr-bg          : #080d14;
    --clr-card        : #0e1520;
    --clr-card-alt    : #0c1422;
    --clr-border      : #1a2535;
    --clr-text        : #e2eaf6;
    --clr-accent      : #2d7ff9;
    --clr-gold        : #f5a623;
    --clr-avatar-bg   : #131f30;
    --clr-input-bg    : #060b12;
    --clr-hero-grad   : linear-gradient(135deg,#0d1e3a,#091628);
    --clr-live-grad   : linear-gradient(135deg,#0a2a1a,#0d3320);
    --clr-export-grad : linear-gradient(135deg,#1a1500,#2a1f00);
    --clr-notice-bg   : rgba(255,255,255,.03);
    --clr-shadow      : rgba(0,0,0,.55);
    --clr-sheet-shadow: rgba(0,0,0,.6);
    --clr-fab-shadow  : rgba(45,127,249,.45);
  }

  /* ── Light theme ── */
  body.light {
    --clr-green       : #00963e;
    --clr-red         : #d4000f;
    --clr-dim         : #6b7c96;
    --clr-bg          : #f0f4f8;
    --clr-card        : #ffffff;
    --clr-card-alt    : #f7fafc;
    --clr-border      : #d1dae6;
    --clr-text        : #0f1923;
    --clr-accent      : #1a5fd4;
    --clr-gold        : #b8620a;
    --clr-avatar-bg   : #e4ecf6;
    --clr-input-bg    : #eef2f7;
    --clr-hero-grad   : linear-gradient(135deg,#ddeeff,#c8dcf5);
    --clr-live-grad   : linear-gradient(135deg,#e6f9ee,#d0f0dc);
    --clr-export-grad : linear-gradient(135deg,#fff8e6,#fef0c8);
    --clr-notice-bg   : rgba(0,0,0,.03);
    --clr-shadow      : rgba(0,0,0,.12);
    --clr-sheet-shadow: rgba(0,0,0,.18);
    --clr-fab-shadow  : rgba(26,95,212,.3);
  }
`;

// ─── IndexedDB helpers ───────────────────────────────────────────────────────
const DB_NAME = "gse-portfolio", DB_VERSION = 1, STORE = "portfolio";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "symbol" });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
async function dbGetAll() {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(STORE,"readonly").objectStore(STORE).getAll(); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
}
async function dbPut(record) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(STORE,"readwrite").objectStore(STORE).put(record); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
}
async function dbDelete(symbol) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(STORE,"readwrite").objectStore(STORE).delete(symbol); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
}
async function dbClear() {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(STORE,"readwrite").objectStore(STORE).clear(); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
}

// ─── Formatters ──────────────────────────────────────────────────────────────
function fmtGHS(v) {
  const abs = Math.abs(v).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v >= 0 ? "+" : "-"}GHS ${abs}`;
}
function fmtPct(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function safeFloat(str) {
  if (!str) return 0;
  const s = str.trim().replace(/,/g, "");
  return parseFloat(s.startsWith(".") ? "0" + s : s);
}
function today() { return new Date().toISOString().slice(0, 10); }

// ─── Portfolio builder ───────────────────────────────────────────────────────
function buildPortfolio(trades) {
  const map = {};
  for (const t of trades) {
    if (!map[t.symbol]) map[t.symbol] = { symbol: t.symbol, totalShares: 0, totalCost: 0, trades: [], currentPrice: null, prevPrice: null };
    const s = map[t.symbol];
    s.totalShares += t.shares;
    s.totalCost   += t.consideration + t.charges;
    s.trades.push(t);
  }
  for (const s of Object.values(map)) s.avgCost = s.totalCost / s.totalShares;
  return map;
}

// ─── PDF extractor ───────────────────────────────────────────────────────────
async function extractTradesFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    fullText += (await page.getTextContent()).items.map(x => x.str).join(" ") + "\n";
  }
  const trades = [];
  const dateRe  = /(\d{2}\/\d{2}\/\d{4})/g;
  const tradeRe = /(?<![a-z])Bought\s+([\d,]+)\s+([A-Z]+)\s+at\s+([\d,.]+)\s+for a consideration of\s+([\d,.]+)\s+and total charges of\s+([\d,.]+)/gi;
  const dates = [...fullText.matchAll(dateRe)];
  let di = 0, m;
  while ((m = tradeRe.exec(fullText)) !== null) {
    while (di + 1 < dates.length && dates[di + 1].index < m.index) di++;
    trades.push({ date: dates[di]?.[1] || "Unknown", shares: safeFloat(m[1]), symbol: m[2].toUpperCase(), pricePerShare: safeFloat(m[3]), consideration: safeFloat(m[4]), charges: safeFloat(m[5]) });
  }
  return trades;
}

// ─── Export helpers ──────────────────────────────────────────────────────────
function exportCSV(portfolio) {
  const stocks = Object.values(portfolio);
  const rows = [["Symbol","Shares","Avg Cost (GHS)","Total Invested (GHS)","Current Price (GHS)","Prev Close (GHS)","Market Value (GHS)","P&L (GHS)","Day Change %","Since Purchase %","Trade Date","Trade Shares","Trade Price (GHS)","Trade Charges (GHS)"]];
  for (const s of stocks) {
    const mv      = s.currentPrice !== null ? s.currentPrice * s.totalShares : "";
    const pnl     = mv !== "" ? (mv - s.totalCost).toFixed(2) : "";
    const dayPct  = s.currentPrice !== null && s.prevPrice !== null && s.prevPrice !== 0 ? (((s.currentPrice - s.prevPrice) / s.prevPrice) * 100).toFixed(2) : "";
    const sincePct= s.currentPrice !== null && s.avgCost ? (((s.currentPrice - s.avgCost) / s.avgCost) * 100).toFixed(2) : "";
    s.trades.forEach((t, i) => rows.push([
      i===0?s.symbol:"", i===0?s.totalShares:"", i===0?s.avgCost.toFixed(4):"",
      i===0?s.totalCost.toFixed(2):"", i===0?(s.currentPrice??""):"", i===0?(s.prevPrice??""):"",
      i===0?(mv!==""?Number(mv).toFixed(2):""):"", i===0?pnl:"", i===0?dayPct:"", i===0?sincePct:"",
      t.date, t.shares, t.pricePerShare, t.charges,
    ]));
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv" }), `gse-portfolio-${today()}.csv`);
}
function exportJSON(portfolio) {
  triggerDownload(new Blob([JSON.stringify(portfolio, null, 2)], { type: "application/json" }), `gse-portfolio-${today()}.json`);
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Global responsive CSS (injected once into <head>) ────────────────────────
//
//  Design tokens:
//    --gutter   : horizontal page padding, fluid 14 → 24 px
//    --gap-sm   : tight spacing (8px equivalent)
//    --gap-md   : medium spacing (12–16px)
//    --radius-card : card border radius, fluid
//    --fs-xs    : 9–11 px
//    --fs-sm    : 10–13 px
//    --fs-base  : 12–15 px
//    --fs-md    : 13–16 px
//    --fs-lg    : 15–18 px
//    --fs-xl    : 18–26 px
//    --fs-2xl   : 22–32 px
//    --fs-3xl   : 26–38 px  (hero total value)
//
const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--clr-bg); -webkit-text-size-adjust: 100%; transition: background 0.25s, color 0.25s; }

  :root {
    --gutter       : clamp(14px, 4.5vw, 24px);
    --gap-sm       : clamp(6px,  1.8vw, 10px);
    --gap-md       : clamp(10px, 2.8vw, 16px);
    --radius-card  : clamp(12px, 3.5vw, 18px);
    --radius-sheet : clamp(18px, 4vw,   28px);
    --fs-xs        : clamp(9px,  2.2vw, 11px);
    --fs-sm        : clamp(10px, 2.5vw, 12px);
    --fs-base      : clamp(11px, 3vw,   14px);
    --fs-md        : clamp(13px, 3.5vw, 15px);
    --fs-lg        : clamp(13px, 3.8vw, 17px);
    --fs-xl        : clamp(15px, 4.2vw, 20px);
    --fs-2xl       : clamp(18px, 5.5vw, 26px);
    --fs-3xl       : clamp(26px, 7vw,   38px);
    --fs-sheet-ttl : clamp(14px, 4vw,   18px);
    --avatar-size  : clamp(36px, 9vw,   46px);
  }

  /* ── Bottom sheet ── */
  .bottom-sheet {
    position: fixed;
    bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: min(100vw, 640px);
    background: var(--clr-card-alt);
    border-top-left-radius:  var(--radius-sheet);
    border-top-right-radius: var(--radius-sheet);
    padding: clamp(18px,5vw,28px) var(--gutter) max(env(safe-area-inset-bottom,20px), 36px);
    z-index: 40;
    border: 1px solid var(--clr-border);
    box-shadow: 0 -8px 40px var(--clr-sheet-shadow);
    max-height: 92dvh;
    overflow-y: auto;
    color: var(--clr-text);
  }

  /* ── Section labels inside sheets ── */
  .sheet-title { font-weight: 700; font-size: var(--fs-sheet-ttl); margin-bottom: var(--gap-md); }

  /* ── FAB ── */
  .fab-btn {
    position: fixed;
    bottom: max(env(safe-area-inset-bottom,0px) + 18px, 22px);
    right:  max(env(safe-area-inset-right, 0px) + 18px, 18px);
    width:  var(--avatar-size);
    height: var(--avatar-size);
    border-radius: 50%;
    background: var(--clr-accent);
    color: #fff;
    font-size: clamp(20px, 5vw, 26px);
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 24px var(--clr-fab-shadow);
    z-index: 20;
  }

  /* ── Holdings section label row ── */
  .section-label {
    padding: var(--gap-sm) var(--gutter) calc(var(--gap-sm) / 2);
    font-size: var(--fs-xs);
    color: var(--clr-dim);
    letter-spacing: 2.2px;
    text-transform: uppercase;
    background: var(--clr-bg);
  }

  /* ── Top border for the holdings list ── */
  .holdings-list {
    border-top: 1px solid var(--clr-border);
    width: 97vw;
    max-width: 640px;
  }

  /* ── Stat row inside detail screen ── */
  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--clr-border);
    padding: clamp(10px, 2.8vw, 14px) 0;
  }
  .stat-label { color: var(--clr-dim); font-size: var(--fs-base); }
  .stat-value { font-weight: 600; font-size: var(--fs-md); }

  /* ── Change mini-cards row (detail screen) ── */
  .change-cards {
    display: flex;
    gap: 0;
    border-top: 1px solid var(--clr-border);
    border-bottom: 1px solid var(--clr-border);
  }
  .change-card {
    flex: 1;
    background: var(--clr-card);
    padding: clamp(10px,2.8vw,14px) var(--gutter,18px);
    border-right: 1px solid var(--clr-border);
  }
  .change-card:last-child { border-right: none; }
  .change-card-note { font-size: var(--fs-sm); color: var(--clr-dim); margin-top: 4px; }

  /* ── Day/YTD badge row inside stock card ── */
  .card-badges { display: flex; justify-content: space-between; align-items: center; }
  .badge-col   { display: flex; flex-direction: column; gap: 2px; }
  .badge-col-right { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
  .badge-micro { font-size: var(--fs-xs); color: var(--clr-dim); letter-spacing: 1.4px; text-transform: uppercase; }

  /* ── Export sheet hint text ── */
  .sheet-hint { font-size: var(--fs-sm); color: var(--clr-dim); margin-top: 5px; }

  /* ── Danger confirm box ── */
  .danger-box {
    background: rgba(245,34,45,.06);
    border: 1px solid rgba(245,34,45,.2);
    border-radius: var(--radius-card);
    padding: var(--gap-md);
  }
  .danger-box p { font-size: var(--fs-base); margin: 0 0 var(--gap-md); line-height: 1.55; }

  /* ── Flex button pair ── */
  .btn-pair { display: flex; gap: var(--gap-sm); }
  .btn-pair > * { flex: 1; }

  /* ── Export button row ── */
  .export-row { display: flex; gap: var(--gap-sm); }
  .export-row > * { flex: 1; }

  /* ── Error / info notice box ── */
  .notice-box {
    font-size: var(--fs-sm);
    color: var(--clr-dim);
    margin-top: 5px;
    padding: clamp(7px,2vw,10px) clamp(9px,2.5vw,12px);
    background: var(--clr-notice-bg);
    border-radius: 8px;
    border: 1px solid var(--clr-border);
  }

  /* ── Eye button ── */
  .eye-btn {
    background: none; border: none;
    color: var(--clr-dim);
    cursor: pointer; padding: 4px;
    display: flex; align-items: center;
    border-radius: 6px;
    transition: color 0.15s;
  }
  .eye-btn:hover { color: var(--clr-text); }

  /* ── Theme toggle button ── */
  .theme-btn {
    background: none; border: none;
    color: var(--clr-dim);
    cursor: pointer; padding: 4px;
    display: flex; align-items: center;
    border-radius: 6px;
    font-size: clamp(14px,3.5vw,17px);
    line-height: 1;
    transition: color 0.15s, transform 0.2s;
  }
  .theme-btn:hover { color: var(--clr-text); transform: rotate(20deg); }

  /* ── Back button ── */
  .back-btn {
    background: none; border: none;
    color: var(--clr-accent);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer; padding: 0;
    margin-bottom: clamp(10px, 3vw, 16px);
  }

  /* ── Remove / inline action buttons ── */
  .remove-btn {
    background: rgba(245,34,45,.1);
    border: 1px solid rgba(245,34,45,.2);
    color: var(--clr-red);
    border-radius: 10px;
    padding: clamp(7px,2vw,10px) clamp(10px,2.8vw,14px);
    font-size: var(--fs-base);
    font-weight: 700;
    cursor: pointer;
  }
  .update-price-btn {
    background: var(--clr-accent);
    color: #fff; border: none;
    border-radius: 10px;
    padding: clamp(7px,2vw,10px) clamp(10px,2.8vw,14px);
    font-size: var(--fs-base);
    font-weight: 700;
    cursor: pointer;
  }
  .export-header-btn {
    background: rgba(245,166,35,.12);
    border: 1px solid rgba(245,166,35,.3);
    color: var(--clr-gold);
    border-radius: 10px;
    padding: clamp(4px,1.5vw,7px) clamp(9px,2.5vw,13px);
    font-size: var(--fs-sm);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }

  /* ── Market prices full screen ── */
  .market-screen {
    min-height: 100dvh;
    background: var(--clr-bg);
    color: var(--clr-text);
    font-family: 'DM Sans', sans-serif;
    width: 100%; max-width: 640px; margin: 0 auto;
    padding-bottom: clamp(40px,8vw,60px);
  }
  .market-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: clamp(11px,3vw,14px) var(--gutter,18px);
    border-bottom: 1px solid var(--clr-border);
    background: var(--clr-card);
  }
  .market-row:first-child { border-top: 1px solid var(--clr-border); }
  .market-sym   { font-weight: 700; font-size: var(--fs-md); }
  .market-price { font-weight: 600; font-size: var(--fs-md); }
  .market-right { text-align: right; }
  .market-volume { font-size: var(--fs-xs); color: var(--clr-dim); margin-top: 2px; }

  /* ── Stock price sub-label in home card ── */
  .card-price { font-size: var(--fs-sm); color: var(--clr-dim); margin-top: 1px; }

  /* ── View Market Prices button ── */
  .market-btn {
    background: rgba(45,127,249,.1);
    border: 1px solid rgba(45,127,249,.25);
    color: var(--clr-accent);
    border-radius: 10px;
    padding: clamp(7px,2vw,10px) clamp(10px,2.8vw,14px);
    font-size: var(--fs-base);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .market-btn:disabled { opacity: 0.4; cursor: default; }

  /* ── Sticky top panel ── */
  .sticky-panel {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--clr-bg);
    box-shadow: 0 4px 24px var(--clr-shadow);
    transition: background 0.25s;
  }

  /* ── Tablet+: snap FAB to content column edge ── */
  @media (min-width: 640px) {
    .fab-btn { right: calc(50% - min(50vw, 320px) + 18px); }
  }

  /* ── Spinner animation ── */
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// ─── Styles object (layout + component tokens — all colours via CSS vars) ─────
const S = {
  root   : { minHeight: "100dvh", background: "var(--clr-bg)", color: "var(--clr-text)", fontFamily: "'DM Sans', sans-serif", width: "100%", maxWidth: 640, margin: "0 auto", paddingBottom: "clamp(80px,14vw,110px)" },
  header : { padding: "clamp(28px,8vw,52px) var(--gutter,18px) 8px" },
  hero   : { margin: "clamp(8px,2vw,14px) var(--gutter,18px)", borderRadius: "var(--radius-card)", background: "var(--clr-hero-grad)", padding: "clamp(16px,4vw,24px) var(--gutter,18px)", border: "1px solid var(--clr-border)" },
  label  : { fontSize: "var(--fs-xs)", letterSpacing: 2.2, color: "var(--clr-dim)", textTransform: "uppercase", marginBottom: 3 },
  bigNum : { fontSize: "var(--fs-3xl)", fontWeight: 800, letterSpacing: -1, lineHeight: 1.1 },
  row    : { display: "flex", justifyContent: "space-between", alignItems: "center" },
  card   : { margin: 0, background: "var(--clr-card)", borderRadius: 0, padding: "clamp(12px,3.2vw,16px) var(--gutter,18px)", borderBottom: "1px solid var(--clr-border)", cursor: "pointer" },
  divider: { borderTop: "1px solid var(--clr-border)", margin: "clamp(8px,2.2vw,12px) 0" },

  // Buttons
  btn       : { background: "var(--clr-accent)", color: "#fff", border: "none", borderRadius: 12, padding: "clamp(11px,3vw,14px) 20px", fontWeight: 700, fontSize: "var(--fs-md)", cursor: "pointer", width: "100%", marginTop: "var(--gap-sm)" },
  ghostBtn  : { background: "var(--clr-card)", color: "var(--clr-text)", border: "1px dashed var(--clr-border)", borderRadius: 12, padding: "clamp(11px,3vw,14px) 20px", fontWeight: 600, fontSize: "var(--fs-md)", cursor: "pointer", width: "100%", marginTop: "var(--gap-sm)" },
  liveBtn   : { background: "var(--clr-live-grad)", color: "var(--clr-green)", border: "1px solid rgba(0,200,83,.3)", borderRadius: 12, padding: "clamp(11px,3vw,14px) 20px", fontWeight: 700, fontSize: "var(--fs-md)", cursor: "pointer", width: "100%", marginTop: "var(--gap-sm)", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--gap-sm)" },
  liveBtnDis: { background: "var(--clr-live-grad)", color: "var(--clr-dim)", border: "1px solid rgba(0,200,83,.1)", borderRadius: 12, padding: "clamp(11px,3vw,14px) 20px", fontWeight: 700, fontSize: "var(--fs-md)", cursor: "not-allowed", width: "100%", marginTop: "var(--gap-sm)", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--gap-sm)" },
  exportBtn : { background: "var(--clr-export-grad)", color: "var(--clr-gold)", border: "1px solid rgba(245,166,35,.3)", borderRadius: 12, padding: "clamp(10px,2.8vw,13px) 14px", fontWeight: 700, fontSize: "var(--fs-base)", cursor: "pointer", flex: 1, marginTop: "var(--gap-sm)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 },
  dangerBtn : { background: "rgba(245,34,45,.08)", color: "var(--clr-red)", border: "1px solid rgba(245,34,45,.2)", borderRadius: 12, padding: "clamp(10px,2.8vw,13px) 14px", fontWeight: 700, fontSize: "var(--fs-base)", cursor: "pointer", width: "100%", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  input     : { background: "var(--clr-input-bg)", border: "1px solid var(--clr-border)", borderRadius: 10, color: "var(--clr-text)", padding: "clamp(10px,2.8vw,13px) 13px", fontSize: "var(--fs-lg)", width: "100%", boxSizing: "border-box", marginBottom: "var(--gap-sm)", outline: "none" },

  // Inline badges
  pill        : v => ({ display: "inline-block", padding: "3px 9px", borderRadius: 7, fontSize: "var(--fs-sm)", fontWeight: 700, background: v > 0 ? "rgba(0,200,83,.12)" : v < 0 ? "rgba(245,34,45,.12)" : "rgba(140,155,176,.12)", color: col(v) }),
  changeBadge : v => ({ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 7, fontSize: "var(--fs-sm)", fontWeight: 700, background: v > 0 ? "rgba(0,200,83,.1)" : v < 0 ? "rgba(245,34,45,.1)" : "rgba(140,155,176,.1)", color: col(v) }),
  avatar      : { width: "var(--avatar-size)", height: "var(--avatar-size)", borderRadius: 11, background: "var(--clr-avatar-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "var(--fs-xs)", color: "var(--clr-accent)", flexShrink: 0 },
  dbTag       : { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, fontSize: "var(--fs-xs)", fontWeight: 700, background: "rgba(0,200,83,.1)", color: "var(--clr-green)", letterSpacing: 0.4 },
};

// ─── Small UI components ─────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16"
      style={{ animation: "spin 0.8s linear infinite", display: "inline-block", verticalAlign: "middle", marginRight: 6 }}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2"
        strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}

function Arrow({ value }) {
  if (value === 0) return <span style={{ fontSize: "var(--fs-xs)" }}>━</span>;
  return <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1 }}>{value > 0 ? "▲" : "▼"}</span>;
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [portfolio,      setPortfolio]      = useState({});
  const [dbReady,        setDbReady]        = useState(false);
  const [screen,         setScreen]         = useState("home");
  const [selected,       setSelected]       = useState(null);
  const [showPct,        setShowPct]        = useState(false);
  const [editingPrice,   setEditingPrice]   = useState(null);
  const [priceInput,     setPriceInput]     = useState("");
  const [prevInput,      setPrevInput]      = useState("");
  const [loading,        setLoading]        = useState(false);
  const [loadMsg,        setLoadMsg]        = useState("");
  const [error,          setError]          = useState("");
  const [manualOpen,     setManualOpen]     = useState(false);
  const [manForm,        setManForm]        = useState({ symbol: "", shares: "", price: "", charges: "", date: "" });
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [fetchError,     setFetchError]     = useState("");
  const [lastUpdated,    setLastUpdated]    = useState(null);
  const [exportOpen,     setExportOpen]     = useState(false);
  const [confirmClear,   setConfirmClear]   = useState(false);
  const [hidden,         setHidden]         = useState(false);
  const [liveSnapshot,   setLiveSnapshot]   = useState(null);
  const [showMarket,     setShowMarket]     = useState(false);
  const [lightTheme,     setLightTheme]     = useState(false);

  // ── Apply theme class to body ─────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle("light", lightTheme);
  }, [lightTheme]);
  const fileRef   = useRef();
  const importRef = useRef();

  // ── Inject global CSS once ────────────────────────────────────────────────
  useEffect(() => {
    if (!document.getElementById("gse-theme")) {
      const t = document.createElement("style");
      t.id = "gse-theme"; t.textContent = THEME_CSS;
      document.head.prepend(t);
    }
    if (!document.getElementById("gse-global")) {
      const g = document.createElement("style");
      g.id = "gse-global"; g.textContent = GLOBAL_CSS;
      document.head.appendChild(g);
    }
  }, []);

  // ── Load portfolio from IndexedDB on mount ────────────────────────────────
  useEffect(() => {
    dbGetAll()
      .then(rows => {
        const map = {};
        for (const row of rows) map[row.symbol] = row;
        setPortfolio(map);
        setDbReady(true);
      })
      .catch(() => setDbReady(true));
  }, []);

  // ── Persist every change to IndexedDB ────────────────────────────────────
  const isFirst = useRef(true);
  useEffect(() => {
    if (!dbReady) return;
    if (isFirst.current) { isFirst.current = false; return; }
    Object.values(portfolio).forEach(r => dbPut(r).catch(console.error));
  }, [portfolio, dbReady]);

  const removeSymbol = useCallback(async sym => {
    await dbDelete(sym);
    setPortfolio(prev => { const n = { ...prev }; delete n[sym]; return n; });
  }, []);

  // ── PDF import ────────────────────────────────────────────────────────────
  async function handleFile(e) {
    const file = e.target.files[0]; if (!file) return;
    setLoading(true); setError(""); setLoadMsg("Reading PDF…");
    try {
      const trades = await extractTradesFromPDF(file);
      if (!trades?.length) {
        setError("No 'Bought' transactions found. Ensure the PDF is from IC Securities.");
      } else {
        setLoadMsg(`Found ${trades.length} transactions…`);
        setPortfolio(prev => {
          const built = buildPortfolio(trades), next = { ...prev };
          for (const [sym, data] of Object.entries(built)) {
            if (next[sym]) {
              next[sym].totalShares += data.totalShares;
              next[sym].totalCost   += data.totalCost;
              next[sym].trades       = [...next[sym].trades, ...data.trades];
              next[sym].avgCost      = next[sym].totalCost / next[sym].totalShares;
            } else {
              next[sym] = { ...data, currentPrice: null, prevPrice: null };
            }
          }
          return next;
        });
      }
    } catch (err) { setError("Error parsing PDF: " + err.message); }
    setLoading(false); setLoadMsg(""); e.target.value = "";
  }

  // ── JSON backup restore ───────────────────────────────────────────────────
  async function handleJSONImport(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid backup format.");
      await dbClear();
      for (const r of Object.values(data)) await dbPut(r);
      setPortfolio(data);
    } catch (err) { setError("Import failed: " + err.message); }
    e.target.value = ""; setExportOpen(false);
  }

  // ── Fetch live prices ─────────────────────────────────────────────────────
  async function fetchLivePrices() {
    setFetchingPrices(true); setFetchError("");
    try {
      const res = await fetch("https://dev.kwayisi.org/apis/gse/live");
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      // Store full snapshot (sorted by % change desc) for market prices page
      const snapshot = [...data].sort((a, b) => b.change - a.change);
      setLiveSnapshot({ items: snapshot, fetchedAt: new Date() });
      const priceMap = {};
      for (const item of data) priceMap[item.name.toUpperCase()] = { price: item.price, prevPrice: item.change !== 0 ? item.price / (1 + item.change / 100) : item.price, dayChangePct: item.change };
      let matched = 0, unmatched = [];
      setPortfolio(prev => {
        const next = { ...prev };
        for (const sym of Object.keys(next)) {
          const hit = priceMap[sym];
          if (hit) { matched++; next[sym] = { ...next[sym], currentPrice: hit.price, prevPrice: parseFloat(hit.prevPrice.toFixed(4)), dayChangePct: hit.dayChangePct }; }
          else unmatched.push(sym);
        }
        return next;
      });
      setLastUpdated(new Date());
      if (unmatched.length) setFetchError(`Updated ${matched} stock${matched !== 1 ? "s" : ""}. Not found on GSE: ${unmatched.join(", ")}`);
    } catch (err) { setFetchError("Failed to fetch prices: " + err.message); }
    setFetchingPrices(false);
  }

  // ── Add manual stock ──────────────────────────────────────────────────────
  function addManual() {
    const { symbol, shares, price, charges, date } = manForm;
    if (!symbol || !shares || !price) return;
    const sym   = symbol.toUpperCase().trim();
    const trade = { date: date || new Date().toLocaleDateString("en-GB"), shares: parseFloat(shares), symbol: sym, pricePerShare: parseFloat(price), consideration: parseFloat(shares) * parseFloat(price), charges: parseFloat(charges) || 0 };
    setPortfolio(prev => {
      const ex = prev[sym] ?? { symbol: sym, totalShares: 0, totalCost: 0, trades: [], currentPrice: null, prevPrice: null };
      const ns = ex.totalShares + trade.shares, nc = ex.totalCost + trade.consideration + trade.charges;
      return { ...prev, [sym]: { ...ex, totalShares: ns, totalCost: nc, trades: [...ex.trades, trade], avgCost: nc / ns } };
    });
    setManForm({ symbol: "", shares: "", price: "", charges: "", date: "" }); setManualOpen(false);
  }

  // ── Save price manually ───────────────────────────────────────────────────
  function savePrice(sym) {
    const cur = parseFloat(priceInput), prev = parseFloat(prevInput);
    if (isNaN(cur)) return;
    setPortfolio(p => ({ ...p, [sym]: { ...p[sym], currentPrice: cur, prevPrice: isNaN(prev) ? p[sym].prevPrice : prev } }));
    setEditingPrice(null);
  }

  // ── Clear all ─────────────────────────────────────────────────────────────
  async function clearAll() {
    await dbClear(); setPortfolio({}); setConfirmClear(false); setExportOpen(false);
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const stocks        = Object.values(portfolio);
  const totalInvested = stocks.reduce((s, x) => s + x.totalCost, 0);
  const totalValue    = stocks.reduce((s, x) => s + (x.currentPrice !== null ? x.currentPrice * x.totalShares : x.totalCost), 0);
  const totalPnl      = totalValue - totalInvested;
  const totalPnlPct   = totalInvested ? (totalPnl / totalInvested) * 100 : 0;
  const totalDayPnl   = stocks.reduce((s, x) => x.currentPrice !== null && x.prevPrice !== null ? s + (x.currentPrice - x.prevPrice) * x.totalShares : s, 0);
  const totalDayPct   = (totalValue - totalDayPnl) ? (totalDayPnl / (totalValue - totalDayPnl)) * 100 : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // DETAIL SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  if (screen === "detail" && selected && portfolio[selected]) {
    const s       = portfolio[selected];
    const curVal  = s.currentPrice !== null ? s.currentPrice * s.totalShares : null;
    const pnl     = curVal !== null ? curVal - s.totalCost : null;
    const pnlPct  = pnl !== null && s.totalCost ? (pnl / s.totalCost) * 100 : null;
    const dayPnl  = s.currentPrice !== null && s.prevPrice !== null ? (s.currentPrice - s.prevPrice) * s.totalShares : null;
    const dayPct  = dayPnl !== null && s.prevPrice ? ((s.currentPrice - s.prevPrice) / s.prevPrice) * 100 : null;
    const yearPct = s.currentPrice !== null && s.avgCost ? ((s.currentPrice - s.avgCost) / s.avgCost) * 100 : null;

    return (
      <div style={S.root}>

        {/* Header */}
        <div style={S.header}>
          <button className="back-btn" onClick={() => setScreen("home")}>← Back</button>
          <div style={S.row}>
            <div>
              <div style={S.label}>Stock</div>
              <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: -0.5 }}>{s.symbol}</div>
            </div>
            <div style={{ display: "flex", gap: "var(--gap-sm)", alignItems: "center" }}>
              <button className="theme-btn" onClick={() => setLightTheme(t => !t)} title={lightTheme ? "Switch to dark" : "Switch to light"}>
                {lightTheme ? "🌙" : "☀️"}
              </button>
              <button className="eye-btn" onClick={() => setHidden(h => !h)} title={hidden ? "Show amounts" : "Hide amounts"}>
                {hidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              {liveSnapshot && (
                <button className="market-btn" onClick={() => setShowMarket(true)}>📈 Market</button>
              )}
              <button className="remove-btn" onClick={() => removeSymbol(s.symbol).then(() => setScreen("home"))}>Remove</button>
              <button className="update-price-btn" onClick={() => { setEditingPrice(s.symbol); setPriceInput(s.currentPrice ?? ""); setPrevInput(s.prevPrice ?? ""); }}>Update Price</button>
            </div>
          </div>
        </div>

        {/* Hero */}
        <div style={S.hero}>
          <div style={S.label}>Market Value</div>
          <div style={S.bigNum}>{hidden ? "••••••" : `GHS ${(curVal ?? s.totalCost).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
          <div style={{ display: "flex", gap: "clamp(16px,4vw,28px)", marginTop: "clamp(10px,2.8vw,16px)" }}>
            {pnl    !== null && <div onClick={() => setShowPct(!showPct)} style={{ cursor: "pointer" }}><div style={S.label}>Total P&L</div><div style={{ color: hidden ? "var(--clr-dim)" : col(pnl),    fontWeight: 700, fontSize: "var(--fs-xl)" }}>{hidden ? "••••" : (showPct ? fmtPct(pnlPct) : fmtGHS(pnl))}</div></div>}
            {dayPnl !== null && <div onClick={() => setShowPct(!showPct)} style={{ cursor: "pointer" }}><div style={S.label}>Today</div>    <div style={{ color: hidden ? "var(--clr-dim)" : col(dayPnl), fontWeight: 700, fontSize: "var(--fs-xl)" }}>{hidden ? "••••" : (showPct ? fmtPct(dayPct) : fmtGHS(dayPnl))}</div></div>}
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", marginTop: "clamp(8px,2vw,12px)" }}>Tap to toggle GHS ↔ %</div>
        </div>

        {/* Day & Since-purchase change mini cards */}
        {(dayPct !== null || yearPct !== null) && (
          <div className="change-cards">
            {dayPct !== null && (
              <div className="change-card">
                <div style={S.label}>Day Change</div>
                <div style={{ ...S.changeBadge(dayPct), marginTop: 4 }}><Arrow value={dayPct} />{fmtPct(dayPct)}</div>
                <div className="change-card-note">{hidden ? "••••" : fmtGHS((s.currentPrice - s.prevPrice) * s.totalShares)}</div>
              </div>
            )}
            {yearPct !== null && (
              <div className="change-card">
                <div style={S.label}>Since Purchase</div>
                <div style={{ ...S.changeBadge(yearPct), marginTop: 4 }}><Arrow value={yearPct} />{fmtPct(yearPct)}</div>
                <div className="change-card-note">{hidden ? "avg •••• → ••••" : `avg GHS ${s.avgCost.toFixed(4)} → ${s.currentPrice}`}</div>
              </div>
            )}
          </div>
        )}

        {/* Stats table */}
        <div style={{ borderTop: "1px solid var(--clr-border)", borderBottom: "1px solid var(--clr-border)", background: "var(--clr-card)", padding: "0 var(--gutter,18px)" }}>
          {[
            ["Shares Held",      s.totalShares.toLocaleString()],
            ["Avg Cost / Share", hidden ? "••••" : `GHS ${s.avgCost.toFixed(4)}`],
            ["Current Price",    hidden ? "••••" : (s.currentPrice !== null ? `GHS ${s.currentPrice}` : "—")],
            ["Prev Close",       hidden ? "••••" : (s.prevPrice    !== null ? `GHS ${s.prevPrice}`    : "—")],
            ["Total Invested",   hidden ? "••••••" : `GHS ${s.totalCost.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`],
          ].map(([k, v]) => (
            <div key={k} className="stat-row">
              <span className="stat-label">{k}</span>
              <span className="stat-value">{v}</span>
            </div>
          ))}
        </div>

        {/* Purchase history */}
        <div className="section-label">Purchase History</div>
        <div className="holdings-list">
        {s.trades.map((t, i) => (
          <div key={i} style={{ ...S.card, cursor: "default" }}>
            <div style={S.row}>
              <span style={{ color: "var(--clr-dim)", fontSize: "var(--fs-base)" }}>{t.date}</span>
              <span style={S.pill(-1)}>{hidden ? "••••••" : `-GHS ${(t.consideration + t.charges).toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}</span>
            </div>
            <div style={{ marginTop: "clamp(3px,1vw,6px)", fontSize: "var(--fs-base)", color: "var(--clr-dim)" }}>
              {t.shares} shares {hidden ? "@ •••• · Fees: ••••" : `@ GHS ${t.pricePerShare} · Fees: GHS ${t.charges}`}
            </div>
          </div>
        ))}
        </div>

        {/* Update price sheet */}
        {editingPrice === s.symbol && (
          <div className="bottom-sheet">
            <div className="sheet-title">Update {s.symbol} Price</div>
            <div style={S.label}>Current Price (GHS)</div>
            <input style={S.input} type="number" value={priceInput} onChange={e => setPriceInput(e.target.value)} placeholder="e.g. 1.05" />
            <div style={S.label}>Previous Close (GHS)</div>
            <input style={S.input} type="number" value={prevInput}  onChange={e => setPrevInput(e.target.value)}  placeholder="e.g. 0.98" />
            <div className="btn-pair" style={{ marginTop: "var(--gap-sm)" }}>
              <button style={{ ...S.btn, background: "var(--clr-card)", marginTop: 0 }} onClick={() => setEditingPrice(null)}>Cancel</button>
              <button style={{ ...S.btn, marginTop: 0 }} onClick={() => savePrice(s.symbol)}>Save</button>
            </div>
          </div>
        )}

        {/* ── Market Prices overlay screen ── */}
        {showMarket && liveSnapshot && (
          <div className="market-screen" style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 50, overflowY: "auto", height: "100dvh" }}>
            {/* Header */}
            <div style={{ ...S.header, position: "sticky", top: 0, background: "var(--clr-bg)", zIndex: 10, boxShadow: "0 2px 16px rgba(0,0,0,.5)" }}>
              <button className="back-btn" onClick={() => setShowMarket(false)}>← Back</button>
              <div style={S.row}>
                <div>
                  <div style={S.label}>Ghana Stock Exchange</div>
                  <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: -0.5 }}>Market Prices</div>
                </div>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", textAlign: "right" }}>
                  {liveSnapshot.items.length} stocks<br />
                  <span style={{ color: "var(--clr-dim)" }}>
                    {liveSnapshot.fetchedAt.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            </div>

            {/* Summary bar: gainers / losers / unchanged */}
            {(() => {
              const gainers   = liveSnapshot.items.filter(x => x.change > 0).length;
              const losers    = liveSnapshot.items.filter(x => x.change < 0).length;
              const unchanged = liveSnapshot.items.filter(x => x.change === 0).length;
              return (
                <div style={{ display: "flex", borderBottom: "1px solid var(--clr-border)", borderTop: "1px solid var(--clr-border)", background: "var(--clr-card)" }}>
                  {[["▲ Gainers", gainers, "var(--clr-green)"], ["▼ Losers", losers, "var(--clr-red)"], ["━ Unchanged", unchanged, "var(--clr-dim)"]].map(([label, count, color]) => (
                    <div key={label} style={{ flex: 1, padding: "clamp(8px,2vw,12px) var(--gutter,18px)", textAlign: "center", borderRight: "1px solid var(--clr-border)" }}>
                      <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</div>
                      <div style={{ fontWeight: 800, fontSize: "var(--fs-xl)", color, marginTop: 2 }}>{count}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Column headers */}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "clamp(6px,1.5vw,9px) var(--gutter,18px)", background: "var(--clr-bg)" }}>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.8, textTransform: "uppercase" }}>Symbol</span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.8, textTransform: "uppercase" }}>Price · Change · Volume</span>
            </div>

            {/* Price rows */}
            {liveSnapshot.items.map(item => {
              const inPortfolio = !!portfolio[item.name.toUpperCase()];
              const prevPrice   = item.change !== 0 ? item.price / (1 + item.change / 100) : item.price;
              return (
                <div key={item.name} className="market-row" style={{ background: inPortfolio ? "rgba(45,127,249,.06)" : "var(--clr-card)" }}>
                  <div>
                    <div className="market-sym" style={{ color: inPortfolio ? "var(--clr-accent)" : "var(--clr-text)" }}>
                      {item.name}
                      {inPortfolio && <span style={{ fontSize: "var(--fs-xs)", color: "var(--clr-accent)", marginLeft: 6, fontWeight: 600 }}>● held</span>}
                    </div>
                    <div className="market-volume">Vol: {item.volume?.toLocaleString() ?? "—"}</div>
                  </div>
                  <div className="market-right">
                    <div className="market-price">GHS {item.price.toFixed(2)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end", marginTop: 2 }}>
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)" }}>prev {prevPrice.toFixed(2)}</span>
                      <div style={{ ...S.changeBadge(item.change), fontSize: "var(--fs-xs)", padding: "2px 6px" }}>
                        <Arrow value={item.change} />{item.change >= 0 ? "+" : ""}{item.change.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOME SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>

      {/* ══ STICKY PANEL: header + hero + action buttons ══ */}
      <div className="sticky-panel">

        {/* Header */}
        <div style={S.header}>
          <div style={{ ...S.row, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 3, textTransform: "uppercase" }}>IC Securities · GSE</div>
              <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: -0.5, marginTop: 2 }}>My Portfolio</div>
            </div>
            <div style={{ display: "flex", gap: "var(--gap-sm)", alignItems: "center", paddingTop: "clamp(4px,1.5vw,8px)" }}>
              {dbReady && <div style={S.dbTag}>💾 Saved</div>}
              <button className="theme-btn" onClick={() => setLightTheme(t => !t)} title={lightTheme ? "Switch to dark" : "Switch to light"}>
                {lightTheme ? "🌙" : "☀️"}
              </button>
              <button className="eye-btn" onClick={() => setHidden(h => !h)} title={hidden ? "Show amounts" : "Hide amounts"}>
                {hidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              {stocks.length > 0 && (
                <button className="export-header-btn" onClick={() => { setExportOpen(true); setConfirmClear(false); }}>Export ↗</button>
              )}
            </div>
          </div>
        </div>

        {/* Hero card */}
        <div style={S.hero}>
          <div style={S.label}>Total Value</div>
          <div style={S.bigNum}>{hidden ? "••••••" : `GHS ${totalValue.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
          <div style={{ display: "flex", gap: "clamp(16px,4vw,28px)", marginTop: "clamp(10px,2.8vw,16px)" }}>
            <div onClick={() => setShowPct(!showPct)} style={{ cursor: "pointer" }}>
              <div style={S.label}>Total P&L</div>
              <div style={{ color: hidden ? "var(--clr-dim)" : col(totalPnl), fontWeight: 700, fontSize: "var(--fs-xl)" }}>{hidden ? "••••" : (showPct ? fmtPct(totalPnlPct) : fmtGHS(totalPnl))}</div>
            </div>
            <div onClick={() => setShowPct(!showPct)} style={{ cursor: "pointer" }}>
              <div style={S.label}>Today</div>
              <div style={{ color: hidden ? "var(--clr-dim)" : col(totalDayPnl), fontWeight: 700, fontSize: "var(--fs-xl)" }}>{hidden ? "••••" : (showPct ? fmtPct(totalDayPct) : fmtGHS(totalDayPnl))}</div>
            </div>
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", marginTop: "clamp(8px,2vw,12px)" }}>Tap figures to toggle GHS ↔ %</div>
        </div>

        {/* Action buttons */}
        <div style={{ padding: "0 var(--gutter,18px) var(--gap-md,12px)" }}>
          <input ref={fileRef}   type="file" accept=".pdf"  style={{ display: "none" }} onChange={handleFile} />
          <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleJSONImport} />

          <button style={S.ghostBtn} onClick={() => fileRef.current.click()} disabled={loading}>
            {loading ? <><Spinner />{loadMsg}</> : "⬆ Import PDF Statement"}
          </button>
          {error && <div style={{ color: "var(--clr-red)", fontSize: "var(--fs-sm)", marginTop: "var(--gap-sm)" }}>{error}</div>}

          {stocks.length > 0 && (
            <>
              <button style={fetchingPrices ? S.liveBtnDis : S.liveBtn} onClick={fetchLivePrices} disabled={fetchingPrices}>
                {fetchingPrices ? <><Spinner />Fetching GSE prices…</> : <><span>⚡</span>Fetch Live Prices</>}
              </button>
              {lastUpdated && !fetchingPrices && (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--clr-dim)", marginTop: "var(--gap-sm)", textAlign: "center" }}>
                  Last updated {lastUpdated.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
              {fetchError && <div className="notice-box">{fetchError}</div>}
            </>
          )}
        </div>

      </div>{/* end sticky-panel */}

      {/* ── Holdings list (scrolls beneath sticky panel) ── */}
      <div className="holdings-list">
        {stocks.length > 0 && <div className="section-label">Holdings · {stocks.length} stocks</div>}
      {stocks.length === 0 && !loading && (
        <div style={{ textAlign: "center", color: "var(--clr-dim)", marginTop: "clamp(40px,10vw,72px)", fontSize: "var(--fs-md)", lineHeight: 1.8, padding: "0 var(--gutter,18px)" }}>
          {dbReady
            ? <>Import your IC Securities PDF or tap <strong style={{ color: "var(--clr-accent)" }}>+</strong> to add manually.</>
            : <><Spinner />Loading saved portfolio…</>}
        </div>
      )}

      {stocks.map(s => {
        const curVal  = s.currentPrice !== null ? s.currentPrice * s.totalShares : null;
        const pnl     = curVal !== null ? curVal - s.totalCost : null;
        const pnlPct  = pnl !== null && s.totalCost ? (pnl / s.totalCost) * 100 : null;
        const dayPnl  = s.currentPrice !== null && s.prevPrice !== null ? (s.currentPrice - s.prevPrice) * s.totalShares : null;
        const dayPct  = dayPnl !== null && s.prevPrice ? ((s.currentPrice - s.prevPrice) / s.prevPrice) * 100 : null;
        const yearPct = s.currentPrice !== null && s.avgCost ? ((s.currentPrice - s.avgCost) / s.avgCost) * 100 : null;

        return (
          <div key={s.symbol} style={S.card} onClick={() => { setSelected(s.symbol); setScreen("detail"); }}>
            <div style={S.row}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--gap-md)" }}>
                <div style={S.avatar}>{s.symbol.slice(0, 4)}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "var(--fs-lg)" }}>{s.symbol}</div>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--clr-dim)" }}>{s.totalShares.toLocaleString()} shares</div>
                  {s.currentPrice !== null && (
                    <div className="card-price">GHS {s.currentPrice} / share</div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: "var(--fs-md)" }}>{hidden ? "••••••" : `GHS ${(curVal ?? s.totalCost).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
                {pnl !== null && (
                  <div onClick={e => { e.stopPropagation(); setShowPct(!showPct); }} style={{ ...S.pill(hidden ? 0 : pnl), cursor: "pointer", marginTop: 4 }}>
                    {hidden ? "••••" : (showPct ? fmtPct(pnlPct) : fmtGHS(pnl))}
                  </div>
                )}
              </div>
            </div>

            {(dayPct !== null || yearPct !== null) && (
              <>
                <div style={S.divider} />
                <div className="card-badges">
                  {dayPct !== null ? (
                    <div className="badge-col">
                      <span className="badge-micro">Day</span>
                      <div style={{ ...S.changeBadge(dayPct), cursor: "pointer" }} onClick={e => { e.stopPropagation(); setShowPct(!showPct); }}>
                        <Arrow value={dayPct} />{hidden ? "••••" : (showPct ? fmtPct(dayPct) : fmtGHS(dayPnl))}
                      </div>
                    </div>
                  ) : <div />}
                  {yearPct !== null ? (
                    <div className="badge-col-right">
                      <span className="badge-micro">Since Purchase</span>
                      <div style={S.changeBadge(yearPct)}><Arrow value={yearPct} />{hidden ? "••••" : fmtPct(yearPct)}</div>
                    </div>
                  ) : <div />}
                </div>
              </>
            )}

            {s.currentPrice === null && (
              <div onClick={e => { e.stopPropagation(); setEditingPrice(s.symbol); setPriceInput(""); setPrevInput(""); }}
                style={{ marginTop: "var(--gap-sm)", fontSize: "var(--fs-sm)", color: "var(--clr-accent)", cursor: "pointer" }}>
                + Set current price
              </div>
            )}
          </div>
        );
      })}
      </div>{/* end holdings-list */}

      {/* ── Update price sheet (home) ── */}
      {editingPrice && screen === "home" && (
        <div className="bottom-sheet">
          <div className="sheet-title">Update {editingPrice} Price</div>
          <div style={S.label}>Current Price (GHS)</div>
          <input style={S.input} type="number" value={priceInput} onChange={e => setPriceInput(e.target.value)} placeholder="e.g. 1.05" />
          <div style={S.label}>Previous Close (GHS)</div>
          <input style={S.input} type="number" value={prevInput}  onChange={e => setPrevInput(e.target.value)}  placeholder="e.g. 0.98" />
          <div className="btn-pair" style={{ marginTop: "var(--gap-sm)" }}>
            <button style={{ ...S.btn, background: "var(--clr-card)", marginTop: 0 }} onClick={() => setEditingPrice(null)}>Cancel</button>
            <button style={{ ...S.btn, marginTop: 0 }} onClick={() => savePrice(editingPrice)}>Save</button>
          </div>
        </div>
      )}

      {/* ── Add manual stock sheet ── */}
      {manualOpen && (
        <div className="bottom-sheet">
          <div className="sheet-title">Add Stock Manually</div>
          {[["Symbol","symbol","e.g. MTNGH"],["Shares","shares","e.g. 150"],["Price per Share (GHS)","price","e.g. 5.60"],["Brokerage Charges (GHS)","charges","e.g. 18.90"],["Date","date","e.g. 26/02/2026"]].map(([label, key, ph]) => (
            <div key={key}>
              <div style={S.label}>{label}</div>
              <input style={S.input} placeholder={ph} value={manForm[key]} onChange={e => setManForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="btn-pair" style={{ marginTop: "var(--gap-sm)" }}>
            <button style={{ ...S.btn, background: "var(--clr-card)", marginTop: 0 }} onClick={() => setManualOpen(false)}>Cancel</button>
            <button style={{ ...S.btn, marginTop: 0 }} onClick={addManual}>Add</button>
          </div>
        </div>
      )}

      {/* ── Data & Export sheet ── */}
      {exportOpen && (
        <div className="bottom-sheet">
          <div style={{ ...S.row, marginBottom: "var(--gap-md)" }}>
            <div className="sheet-title" style={{ margin: 0 }}>Data & Export</div>
            <button onClick={() => { setExportOpen(false); setConfirmClear(false); }}
              style={{ background: "none", border: "none", color: "var(--clr-dim)", fontSize: "var(--fs-xl)", cursor: "pointer", lineHeight: 1, padding: 0 }}>✕</button>
          </div>

          <div style={S.label}>Export portfolio</div>
          <div className="export-row">
            <button style={S.exportBtn} onClick={() => { exportCSV(portfolio); setExportOpen(false); }}>📊 CSV (spreadsheet)</button>
            <button style={S.exportBtn} onClick={() => { exportJSON(portfolio); setExportOpen(false); }}>💾 JSON (backup)</button>
          </div>
          <div className="sheet-hint">CSV includes all holdings + trade history. JSON can be used to restore this portfolio on another device.</div>

          <div style={{ ...S.divider, margin: "clamp(14px,3.5vw,20px) 0 clamp(10px,2.8vw,16px)" }} />

          <div style={S.label}>Restore from backup</div>
          <button style={{ ...S.ghostBtn, marginTop: 4 }} onClick={() => importRef.current.click()}>⬆ Import JSON Backup</button>
          <div className="sheet-hint">Replaces your current portfolio with data from a JSON backup file.</div>

          <div style={{ ...S.divider, margin: "clamp(14px,3.5vw,20px) 0 clamp(10px,2.8vw,16px)" }} />

          <div style={S.label}>Danger zone</div>
          {!confirmClear ? (
            <button style={S.dangerBtn} onClick={() => setConfirmClear(true)}>🗑 Clear all portfolio data</button>
          ) : (
            <div className="danger-box">
              <p>This will permanently delete all holdings and trades from this device. Are you sure?</p>
              <div className="btn-pair">
                <button style={{ ...S.btn, background: "var(--clr-card)", marginTop: 0 }} onClick={() => setConfirmClear(false)}>Cancel</button>
                <button style={{ ...S.btn, background: "var(--clr-red)",  marginTop: 0 }} onClick={clearAll}>Yes, clear all</button>
              </div>
            </div>
          )}
        </div>
      )}

      <button className="fab-btn" onClick={() => setManualOpen(true)}>+</button>
    </div>
  );
}