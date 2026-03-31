import { useState, useRef, useEffect, useCallback } from "react";

// pdfjs is bundled locally in src/lib/ — no npm dependency, works fully offline.
// The worker is loaded as a raw string and turned into a Blob URL so Safari
// never has to fetch an external file (which it blocks for workers).
import * as pdfjsLib from "./lib/pdf.min.mjs";
import pdfjsWorkerSrc from "./lib/pdf.worker.js?raw";

const workerBlob = new Blob([pdfjsWorkerSrc], { type: "application/javascript" });
const workerBlobUrl = URL.createObjectURL(workerBlob);
pdfjsLib.GlobalWorkerOptions.workerSrc = workerBlobUrl;

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
const DB_NAME = "gse-portfolio", DB_VERSION = 2, STORE = "portfolio";
const STORE_TB = "tbills", STORE_MF = "mutualfunds";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "symbol" });
      if (!db.objectStoreNames.contains(STORE_TB))
        db.createObjectStore(STORE_TB, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_MF))
        db.createObjectStore(STORE_MF, { keyPath: "id" });
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
// Generic helpers for any store
async function storeGetAll(storeName) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(storeName,"readonly").objectStore(storeName).getAll(); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
}
async function storePut(storeName, record) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(storeName,"readwrite").objectStore(storeName).put(record); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
}
async function storeDelete(storeName, id) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(storeName,"readwrite").objectStore(storeName).delete(id); r.onsuccess=e=>res(e.target.result); r.onerror=e=>rej(e.target.error); });
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

// ─── GSE Portfolio Backup format (Base64-encoded JSON) ───────────────────────
// Schema matches the external app format:
//   { version, exportDate, transactions[], favoriteStocks[], favoriteDetails{}, appSignature }
// Each transaction: { id, symbol, type:"buy", shares, price, date, notes, brokerageFee }
function exportPortfolioBackup(portfolio) {
  const transactions = [];
  for (const s of Object.values(portfolio)) {
    for (const t of s.trades) {
      // Convert internal date (DD/MM/YYYY or ISO) to ISO datetime string
      let isoDate = t.date;
      if (t.date && t.date.includes("/")) {
        const [d, m, y] = t.date.split("/");
        isoDate = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}T00:00:00.000`;
      }
      const consideration = t.consideration ?? (t.shares * t.pricePerShare);
      transactions.push({
        id:           t.id ?? crypto.randomUUID(),
        symbol:       s.symbol,
        type:         "buy",
        shares:       t.shares,
        price:        t.pricePerShare,
        date:         isoDate,
        notes:        consideration ? `Consideration: ${consideration.toLocaleString("en-GH", { minimumFractionDigits: 2 })}` : null,
        brokerageFee: t.charges ?? null,
      });
    }
  }
  // Sort by date ascending
  transactions.sort((a, b) => a.date.localeCompare(b.date));

  const symbols = Object.keys(portfolio);
  const favoriteDetails = {};
  for (const s of Object.values(portfolio)) {
    favoriteDetails[s.symbol] = {
      initialPrice: s.avgCost ?? s.trades[0]?.pricePerShare ?? 0,
      timestamp:    Date.now(),
    };
  }

  const payload = {
    version:         "1.0",
    exportDate:      new Date().toISOString(),
    transactions,
    favoriteStocks:  symbols,
    favoriteDetails,
    appSignature:    "GSE_PORTFOLIO_BACKUP",
  };

  const encoded = btoa(JSON.stringify(payload));
  const filename = `GSE_Portfolio_Backup_${new Date().toISOString().replace(/[-:]/g,"").replace("T","_").slice(0,15)}.txt`;
  triggerDownload(new Blob([encoded], { type: "text/plain" }), filename);
}

// Parse an imported GSE_PORTFOLIO_BACKUP .txt file back into internal portfolio format
function parsePortfolioBackup(text) {
  const decoded = atob(text.trim());
  const data    = JSON.parse(decoded);
  if (data.appSignature !== "GSE_PORTFOLIO_BACKUP") throw new Error("Not a valid GSE Portfolio Backup file.");
  // Group transactions by symbol
  const map = {};
  for (const tx of data.transactions) {
    if (tx.type !== "buy") continue;
    const sym = tx.symbol.toUpperCase();
    if (!map[sym]) map[sym] = { symbol: sym, totalShares: 0, totalCost: 0, trades: [], currentPrice: null, prevPrice: null };
    const s      = map[sym];
    const cost   = tx.shares * tx.price;
    const fee    = tx.brokerageFee ?? 0;
    // Normalise date to DD/MM/YYYY
    let dateStr = tx.date ?? "";
    if (dateStr.includes("T")) {
      const [y, m, d] = dateStr.split("T")[0].split("-");
      dateStr = `${d}/${m}/${y}`;
    }
    s.totalShares += tx.shares;
    s.totalCost   += cost + fee;
    s.trades.push({
      id:            tx.id,
      date:          dateStr,
      shares:        tx.shares,
      symbol:        sym,
      pricePerShare: tx.price,
      consideration: cost,
      charges:       fee,
    });
  }
  for (const s of Object.values(map)) s.avgCost = s.totalCost / s.totalShares;
  return map;
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
  @font-face {
    font-family: 'Brighter Sans';
    src: url('/brighter-sans-medium.otf') format('opentype');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--clr-bg); -webkit-text-size-adjust: 100%; transition: background 0.25s, color 0.25s; font-family: 'Brighter Sans', sans-serif; }

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
    bottom: calc(max(env(safe-area-inset-bottom, 0px) + 18px, 22px) + 62px);
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
    width: 98vw;
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
    font-family: 'Brighter Sans', sans-serif;
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
    width: 98vw;
    max-width: 640px;
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

  /* ── Bottom navigation bar ── */
  .bottom-nav {
    position: fixed;
    bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 100%; max-width: 640px;
    background: var(--clr-card-alt);
    border-top: 1px solid var(--clr-border);
    display: flex;
    z-index: 30;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    box-shadow: 0 -4px 20px var(--clr-shadow);
  }
  .nav-item {
    flex: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: clamp(8px,2vw,12px) 4px;
    gap: 3px;
    background: none; border: none;
    color: var(--clr-dim);
    font-family: 'Brighter Sans', sans-serif;
    font-size: var(--fs-xs);
    cursor: pointer;
    transition: color 0.15s;
    letter-spacing: 0.5px;
  }
  .nav-item.active { color: var(--clr-accent); }
  .nav-item svg { width: 20px; height: 20px; }

  /* ── Page wrapper with nav padding ── */
  .page-root {
    min-height: 100dvh;
    background: var(--clr-bg);
    color: var(--clr-text);
    font-family: 'Brighter Sans', sans-serif;
    width: 100%; max-width: 640px;
    margin: 0 auto;
    padding-bottom: clamp(80px,16vw,110px);
  }

  /* ── Investment card (T-Bills / Mutual Funds) ── */
  .inv-card {
    margin: 0;
    background: var(--clr-card);
    border-bottom: 1px solid var(--clr-border);
    padding: clamp(14px,3.5vw,18px) var(--gutter,18px);
    cursor: default;
    width: 98vw;
    max-width: 640px;
  }
  .inv-card-title { font-weight: 700; font-size: var(--fs-lg); }
  .inv-card-sub   { font-size: var(--fs-sm); color: var(--clr-dim); margin-top: 2px; }
  .inv-row { display: flex; justify-content: space-between; align-items: flex-start; }
  .inv-stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border-top: 1px solid var(--clr-border);
    border-bottom: 1px solid var(--clr-border);
    background: var(--clr-card);
    width: 98vw;
    max-width: 640px;
  }
  .inv-stat {
    padding: clamp(10px,2.8vw,14px) var(--gutter,18px);
    border-right: 1px solid var(--clr-border);
    border-bottom: 1px solid var(--clr-border);
  }
  .inv-stat:nth-child(2n) { border-right: none; }
  .inv-stat:nth-last-child(-n+2) { border-bottom: none; }
  .inv-stat-label { font-size: var(--fs-xs); color: var(--clr-dim); letter-spacing: 1.6px; text-transform: uppercase; margin-bottom: 4px; }
  .inv-stat-value { font-weight: 700; font-size: var(--fs-md); }

  /* ── Summary page hero tiles ── */
  .summary-tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(8px,2vw,12px);
    padding: clamp(10px,2.5vw,14px) var(--gutter,18px);
    width: 98vw;
    max-width: 640px;
  }
  .summary-tile {
    background: var(--clr-card);
    border: 1px solid var(--clr-border);
    border-radius: var(--radius-card);
    padding: clamp(12px,3vw,16px);
    display: flex; flex-direction: column; gap: 4px;
  }
  .summary-tile-icon { font-size: clamp(18px,4.5vw,24px); }
  .summary-tile-label { font-size: var(--fs-xs); color: var(--clr-dim); letter-spacing: 1.4px; text-transform: uppercase; }
  .summary-tile-value { font-weight: 800; font-size: var(--fs-lg); }
  .summary-tile-sub   { font-size: var(--fs-xs); color: var(--clr-dim); }

  /* ── MF daily entry row ── */
  .mf-entry-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: clamp(10px,2.8vw,13px) var(--gutter,18px);
    border-bottom: 1px solid var(--clr-border);
    background: var(--clr-card);
    width: 98vw;
    max-width: 640px;
  }
  .mf-entry-row:first-child { border-top: 1px solid var(--clr-border); }

  /* ── Stock Analysis screen ── */
  .signal-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: clamp(8px,2.2vw,11px) clamp(14px,3.5vw,20px);
    border-radius: 50px;
    font-weight: 800;
    font-size: var(--fs-lg);
    letter-spacing: 0.3px;
  }
  .analysis-metric {
    display: flex; justify-content: space-between; align-items: center;
    padding: clamp(10px,2.8vw,14px) var(--gutter,18px);
    border-bottom: 1px solid var(--clr-border);
    width: 98vw; max-width: 640px;
    background: var(--clr-card);
  }
  .analysis-metric:first-child { border-top: 1px solid var(--clr-border); }
  .analysis-metric-label { font-size: var(--fs-base); color: var(--clr-dim); }
  .analysis-metric-value { font-weight: 700; font-size: var(--fs-md); }
  .fib-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: clamp(9px,2.5vw,12px) var(--gutter,18px);
    border-bottom: 1px solid var(--clr-border);
    width: 98vw; max-width: 640px;
  }
  .fib-row:first-child { border-top: 1px solid var(--clr-border); }
  .insight-card {
    margin: 0;
    padding: clamp(12px,3vw,16px) var(--gutter,18px);
    border-bottom: 1px solid var(--clr-border);
    background: var(--clr-card);
    width: 98vw; max-width: 640px;
  }
  .insight-title { font-weight: 700; font-size: var(--fs-md); margin-bottom: 4px; }
  .insight-body  { font-size: var(--fs-base); color: var(--clr-dim); line-height: 1.65; }

  /* ── Spinner animation ── */
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// ─── Styles object (layout + component tokens — all colours via CSS vars) ─────
const S = {
  root   : { minHeight: "100dvh", background: "var(--clr-bg)", color: "var(--clr-text)", fontFamily: "'Brighter Sans', sans-serif", width: "100%", maxWidth: 640, margin: "0 auto", paddingBottom: "clamp(90px,18vw,120px)" },
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

// ─── Stock Analysis Screen ────────────────────────────────────────────────────
function StockAnalysisScreen({ lightTheme, setLightTheme, hidden, setHidden }) {

  // ── Input state ───────────────────────────────────────────────────────────
  const [symbol,        setSymbol]        = useState("");
  const [basePrice,     setBasePrice]     = useState("");   // 52-week low / IPO / start
  const [peakPrice,     setPeakPrice]     = useState("");   // all-time high / recent peak
  const [currentPrice,  setCurrentPrice]  = useState("");   // last traded price
  const [openPrice,     setOpenPrice]     = useState("");   // today's open
  const [highPrice,     setHighPrice]     = useState("");   // today's high
  const [lowPrice,      setLowPrice]      = useState("");   // today's low
  const [prevClose,     setPrevClose]     = useState("");   // previous close
  const [avgPrice,      setAvgPrice]      = useState("");   // today's avg traded price
  const [buyPrice,      setBuyPrice]      = useState("");   // best bid on order book
  const [buyVolume,     setBuyVolume]     = useState("");   // total buy volume on order book
  const [sellPrice,     setSellPrice]     = useState("");   // best ask on order book
  const [sellVolume,    setSellVolume]    = useState("");   // total sell volume on order book
  const [dailyVolume,   setDailyVolume]   = useState("");   // total shares traded today
  const [avgDailyVol,   setAvgDailyVol]  = useState("");   // average daily volume (optional)
  const [downDays,      setDownDays]      = useState("");   // consecutive down days (optional)
  const [weekHigh,      setWeekHigh]      = useState("");   // 52-week high (if different from peak)
  const [weekLow,       setWeekLow]       = useState("");   // 52-week low (if different from base)

  // ── Parse inputs ──────────────────────────────────────────────────────────
  const base    = parseFloat(basePrice)    || 0;
  const peak    = parseFloat(peakPrice)    || 0;
  const cur     = parseFloat(currentPrice) || 0;
  const open    = parseFloat(openPrice)    || 0;
  const high    = parseFloat(highPrice)    || 0;
  const low     = parseFloat(lowPrice)     || 0;
  const prev    = parseFloat(prevClose)    || 0;
  const avgPx   = parseFloat(avgPrice)     || 0;
  const buyPx   = parseFloat(buyPrice)     || 0;
  const buyVol  = parseFloat(buyVolume)    || 0;
  const sellPx  = parseFloat(sellPrice)    || 0;
  const sellVol = parseFloat(sellVolume)   || 0;
  const dayVol  = parseFloat(dailyVolume)  || 0;
  const avgVol  = parseFloat(avgDailyVol)  || 0;
  const dwnDays = parseInt(downDays)       || 0;
  const wkHigh  = parseFloat(weekHigh)     || peak;
  const wkLow   = parseFloat(weekLow)      || base;

  const ready = base > 0 && peak > 0 && cur > 0 && peak > base;

  // ── Core price metrics ────────────────────────────────────────────────────
  const totalRally      = peak - base;
  const rallyPct        = (totalRally / base) * 100;
  const drawdown        = peak - cur;
  const drawdownPct     = (drawdown / peak) * 100;
  const gainFromBase    = cur - base;
  const gainFromBasePct = (gainFromBase / base) * 100;

  // Day metrics
  const dayChange      = prev > 0 ? cur - prev : 0;
  const dayChangePct   = prev > 0 ? (dayChange / prev) * 100 : 0;
  const dayRange       = high > 0 && low > 0 ? high - low : 0;
  const rangePosition  = dayRange > 0 ? ((cur - low) / dayRange) * 100 : null;

  // Special day pattern detections
  const isGapDown      = open > 0 && prev > 0 && open < prev * 0.99;  // opened >1% below prev close
  const isGapUp        = open > 0 && prev > 0 && open > prev * 1.01;
  const isLockLimit    = high > 0 && low > 0 && Math.abs(high - low) < 0.01; // high == low: zero intraday range
  const isWeakClose    = high > 0 && low > 0 && cur > 0 && dayRange > 0 && ((cur - low) / dayRange) < 0.2; // closing in bottom 20% of range
  const isStrongClose  = dayRange > 0 && ((cur - low) / dayRange) > 0.8;
  const avgAboveCur    = avgPx > 0 && avgPx > cur; // avg traded price above current = late sellers drove price down

  // 52-week positioning
  const wkRange        = wkHigh - wkLow;
  const wkPosition     = wkRange > 0 ? ((cur - wkLow) / wkRange) * 100 : null; // 0% = at 52w low, 100% = at 52w high

  // ── Order book analysis ───────────────────────────────────────────────────
  const hasBuyers      = buyVol > 0 && buyPx > 0;
  const hasSellers     = sellVol > 0;
  const buySellRatio   = (buyVol > 0 && sellVol > 0) ? buyVol / sellVol : 0;
  const orderImbalance = (buyVol + sellVol) > 0 ? ((sellVol - buyVol) / (buyVol + sellVol)) * 100 : null;
  const spread         = (buyPx > 0 && sellPx > 0) ? sellPx - buyPx : null;
  const spreadPct      = (spread !== null && buyPx > 0) ? (spread / buyPx) * 100 : null;

  // ── Volume analysis ───────────────────────────────────────────────────────
  const daysToAbsorb   = dayVol > 0 && sellVol > 0 ? sellVol / dayVol : null;
  const volRatio       = avgVol > 0 ? dayVol / avgVol : null;
  const overhangMult   = dayVol > 0 && sellVol > 0 ? (sellVol / dayVol).toFixed(1) : null;

  // ── Fibonacci retracement (base → peak) ──────────────────────────────────
  const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(f => ({
    label: `${(f * 100).toFixed(1)}%`, price: peak - f * totalRally, ratio: f,
  }));
  const fib236 = peak - 0.236 * totalRally;
  const fib382 = peak - 0.382 * totalRally;
  const fib500 = peak - 0.500 * totalRally;
  const fib618 = peak - 0.618 * totalRally;
  const fib786 = peak - 0.786 * totalRally;
  const nearestFib = ready ? fibLevels.slice(1).reduce((best, f) =>
    Math.abs(f.price - cur) < Math.abs(best.price - cur) ? f : best
  ) : null;

  // ── Signal scoring (0–100) ────────────────────────────────────────────────
  let score = 50;
  const scoreFactors = []; // collect explanations for transparency
  if (ready) {
    // 1. Fibonacci position
    if      (cur <= fib786) { score += 22; scoreFactors.push(["Deep fib zone (78.6%+)", +22, "green"]); }
    else if (cur <= fib618) { score += 16; scoreFactors.push(["Golden ratio zone (61.8%)", +16, "green"]); }
    else if (cur <= fib500) { score += 8;  scoreFactors.push(["Mid fib zone (50%)", +8, "gold"]); }
    else if (cur <= fib382) { score += 2;  scoreFactors.push(["Shallow fib (38.2%)", +2, "gold"]); }
    else                    { score -= 10; scoreFactors.push(["Above 38.2% — shallow pullback", -10, "red"]); }

    // 2. Order book — zero buyers is the most bearish signal possible
    if (!hasBuyers && buyPx === 0) {
      score -= 22; scoreFactors.push(["Zero buy orders (no floor)", -22, "red"]);
    } else if (!hasBuyers) {
      score -= 14; scoreFactors.push(["No buy volume on book", -14, "red"]);
    } else {
      if      (buySellRatio >= 2)   { score += 14; scoreFactors.push(["Buy vol > 2× sell vol", +14, "green"]); }
      else if (buySellRatio >= 1)   { score += 8;  scoreFactors.push(["Buy vol ≥ sell vol", +8, "green"]); }
      else if (buySellRatio >= 0.5) { score += 2;  scoreFactors.push(["Some buy support", +2, "gold"]); }
      else                          { score -= 8;  scoreFactors.push(["Sell vol dominates book", -8, "red"]); }
    }

    // 3. Sell overhang
    if (daysToAbsorb !== null) {
      if      (daysToAbsorb > 100) { score -= 24; scoreFactors.push(["Sell wall >100 days to clear", -24, "red"]); }
      else if (daysToAbsorb > 50)  { score -= 16; scoreFactors.push(["Sell wall 50–100 days", -16, "red"]); }
      else if (daysToAbsorb > 20)  { score -= 8;  scoreFactors.push(["Sell wall 20–50 days", -8, "gold"]); }
      else if (daysToAbsorb > 5)   { score -= 2;  scoreFactors.push(["Sell wall 5–20 days", -2, "gold"]); }
      else                         { score += 8;  scoreFactors.push(["Sell wall nearly cleared", +8, "green"]); }
    }

    // 4. Day change severity
    if (prev > 0) {
      if      (dayChangePct < -8)  { score -= 14; scoreFactors.push([`Heavy distribution (${dayChangePct.toFixed(1)}%)`, -14, "red"]); }
      else if (dayChangePct < -4)  { score -= 7;  scoreFactors.push([`Down day (${dayChangePct.toFixed(1)}%)`, -7, "red"]); }
      else if (dayChangePct < -1)  { score -= 2;  scoreFactors.push([`Slight decline (${dayChangePct.toFixed(1)}%)`, -2, "gold"]); }
      else if (dayChangePct > 3)   { score += 6;  scoreFactors.push([`Up day (+${dayChangePct.toFixed(1)}%)`, +6, "green"]); }
      else if (dayChangePct > 1)   { score += 2;  scoreFactors.push([`Slight gain (+${dayChangePct.toFixed(1)}%)`, +2, "green"]); }
    }

    // 5. Gap down — aggressive selling from the open
    if (isGapDown) { score -= 8; scoreFactors.push(["Gap down from prev close", -8, "red"]); }
    if (isGapUp)   { score += 4; scoreFactors.push(["Gap up from prev close", +4, "green"]); }

    // 6. Lock limit / zero intraday range — trapped sellers, no buyers
    if (isLockLimit && !hasBuyers) { score -= 10; scoreFactors.push(["Zero range day + no buyers", -10, "red"]); }

    // 7. Weak/strong close relative to day range
    if (isWeakClose)  { score -= 6; scoreFactors.push(["Closing near day low (weak)", -6, "red"]); }
    if (isStrongClose){ score += 5; scoreFactors.push(["Closing near day high (strong)", +5, "green"]); }

    // 8. Avg price > current — sellers dominated the session
    if (avgAboveCur)  { score -= 5; scoreFactors.push(["Avg price > current (late selling)", -5, "red"]); }

    // 9. Volume vs average
    if (volRatio !== null) {
      if      (volRatio >= 3)   { score += 8;  scoreFactors.push(["Volume 3× average (climax?)", +8, "gold"]); }
      else if (volRatio >= 1.5) { score += 4;  scoreFactors.push(["Above-average volume", +4, "gold"]); }
      else if (volRatio < 0.5)  { score -= 5;  scoreFactors.push(["Below-average volume (weak)", -5, "red"]); }
    }

    // 10. Consecutive down days — exhaustion can be a contrarian signal after many days
    if (dwnDays >= 10) { score += 5;  scoreFactors.push([`${dwnDays} consecutive down days (exhaustion?)`, +5, "gold"]); }
    else if (dwnDays >= 5)  { score -= 4;  scoreFactors.push([`${dwnDays} consecutive down days`, -4, "red"]); }
    else if (dwnDays >= 2)  { score -= 2;  scoreFactors.push([`${dwnDays} consecutive down days`, -2, "red"]); }

    // 11. 52-week positioning
    if (wkPosition !== null) {
      if      (wkPosition < 15)  { score += 8;  scoreFactors.push(["Near 52-week low (value zone)", +8, "green"]); }
      else if (wkPosition < 30)  { score += 4;  scoreFactors.push(["Low end of 52-week range", +4, "gold"]); }
      else if (wkPosition > 85)  { score -= 8;  scoreFactors.push(["Near 52-week high (risky)", -8, "red"]); }
    }

    // 12. Price too close to peak — distribution risk
    if      (drawdownPct < 5)  { score -= 20; scoreFactors.push(["< 5% from peak (overbought)", -20, "red"]); }
    else if (drawdownPct < 15) { score -= 10; scoreFactors.push(["< 15% from peak (elevated)", -10, "red"]); }

    score = Math.max(0, Math.min(100, score));
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const verdict = !ready ? null :
    score >= 72 ? { label: "Strong Buy Zone",    color: "#00c853", bg: "rgba(0,200,83,.13)",   icon: "▲▲" } :
    score >= 58 ? { label: "Cautious Buy",        color: "#69f0ae", bg: "rgba(105,240,174,.1)", icon: "▲"  } :
    score >= 44 ? { label: "Watch & Wait",        color: "#f5a623", bg: "rgba(245,166,35,.13)", icon: "◆"  } :
    score >= 30 ? { label: "Likely More Downside",color: "#ff6b35", bg: "rgba(255,107,53,.12)", icon: "▼"  } :
                  { label: "Avoid / High Risk",   color: "#f5222d", bg: "rgba(245,34,45,.13)",  icon: "▼▼" };

  // ── Price targets ─────────────────────────────────────────────────────────
  const sl  = cur * 0.93;
  const tp2 = fib382;
  const tp3 = peak;

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights = [];
  if (ready) {
    // Rally context
    insights.push({
      icon: "📈", title: "Rally & Retracement Context",
      body: `${symbol || "This stock"} rallied ${rallyPct.toFixed(0)}% from GHS ${base.toFixed(2)} to GHS ${peak.toFixed(2)} — a ${rallyPct > 400 ? "parabolic" : rallyPct > 200 ? "very strong" : rallyPct > 100 ? "strong" : "moderate"} move. It has now retraced ${drawdownPct.toFixed(1)}% from the peak. ${drawdownPct >= 61.8 ? "This is a deep retracement into the golden ratio zone — historically a high-probability reversal area, but only valid if buyers begin to show up." : drawdownPct >= 50 ? "Price is at the midpoint retracement. Watch whether it holds or continues to the 61.8% level." : drawdownPct >= 38.2 ? "At the 38.2% fib — the first meaningful support. A hold here signals strength; a break points to 50% or 61.8%." : "The retracement is still shallow. Further downside toward the 38.2–61.8% zone is likely before a real base forms."}`
    });

    // Order book reading
    insights.push({
      icon: "📋", title: "Order Book Reading",
      body: !hasBuyers
        ? `No buy orders on the order book (Buy: 0.00, Vol: 0). This is the most critical warning signal — zero bids means no institutional or retail buyer is willing to step in at current levels. ${isLockLimit ? "Combined with a zero intraday range (High = Low = Current), this indicates a locked-limit down scenario where the price simply fell with no support whatsoever." : ""} ${sellVol > 0 ? `There are still ${sellVol.toLocaleString()} shares queued on the sell side at GHS ${sellPx > 0 ? sellPx.toFixed(2) : cur.toFixed(2)}. Until meaningful buy volume appears on the order book, the price has no floor.` : ""}`
        : `Buy volume of ${buyVol.toLocaleString()} at GHS ${buyPx.toFixed(2)} vs sell volume of ${sellVol.toLocaleString()} at GHS ${sellPx > 0 ? sellPx.toFixed(2) : cur.toFixed(2)}. The buy/sell ratio is ${buySellRatio.toFixed(2)} — ${buySellRatio >= 1 ? "buyers are matching sellers, a constructive sign." : buySellRatio >= 0.5 ? "sellers still outnumber buyers but some support is emerging." : "sellers heavily dominate — caution required."}`
    });

    // Today's price action with candle interpretation
    if (prev > 0 || open > 0) {
      let candleType = "";
      if (isLockLimit && dayChangePct < -3) candleType = "📛 Lock-limit down — price fell with zero intraday recovery, no buyers engaged.";
      else if (isGapDown && isWeakClose) candleType = "📛 Gap-down bearish candle — opened below previous close and continued falling.";
      else if (isGapDown) candleType = "⚠️ Gap-down open — bearish start, check if recovered.";
      else if (isWeakClose) candleType = "🔴 Bearish candle — closed near session lows, sellers in control.";
      else if (isStrongClose) candleType = "🟢 Bullish candle — closed near session highs, buyers stepped in.";
      else candleType = "🟡 Indecisive session — neither side took clear control.";
      insights.push({
        icon: dayChangePct < -5 ? "🔴" : dayChangePct < 0 ? "🟡" : "🟢",
        title: "Today's Price Action",
        body: `${candleType} Opened GHS ${open > 0 ? open.toFixed(2) : prev.toFixed(2)}, prev close GHS ${prev.toFixed(2)}. Currently ${dayChangePct < 0 ? "down" : "up"} ${Math.abs(dayChangePct).toFixed(2)}% (GHS ${Math.abs(dayChange).toFixed(2)}).${dayRange > 0 ? ` Day range: GHS ${low.toFixed(2)} – GHS ${high.toFixed(2)}.` : ""} ${avgAboveCur ? `Avg traded price of GHS ${avgPx.toFixed(2)} is above current price — this means the average seller today got a better price than current, indicating continued downward pressure into the close.` : avgPx > 0 ? `Avg traded price of GHS ${avgPx.toFixed(2)} is at or below current — buyers late in the session absorbed some supply.` : ""}`
      });
    }

    // Volume overhang
    if (daysToAbsorb !== null) {
      insights.push({
        icon: "📊", title: "Sell Overhang Analysis",
        body: `${sellVol.toLocaleString()} shares on the ask vs ${dayVol.toLocaleString()} traded today. At this pace it would take ~${Math.round(daysToAbsorb)} trading days (${overhangMult}× daily volume) to clear the sell wall. ${daysToAbsorb > 50 ? "This is an extreme overhang that will suppress any price recovery. Every bounce attempt will be sold into. The market is in active distribution — sellers are systematically exiting." : daysToAbsorb > 20 ? "Heavy overhang. Wait for it to shrink to under 10× daily volume before even considering an entry." : daysToAbsorb > 5 ? "Manageable but still needs monitoring. Look for the overhang shrinking on consecutive sessions before entering." : "Light overhang — supply nearly resolved, which is constructive."}`
      });
    }

    // Consecutive down days insight
    if (dwnDays >= 3) {
      const exhaustion = dwnDays >= 8;
      insights.push({
        icon: exhaustion ? "🔄" : "📉",
        title: exhaustion ? "Possible Selling Exhaustion" : "Consecutive Down Days",
        body: exhaustion
          ? `${dwnDays} consecutive down days is an unusually long streak that can mark the late stage of a distribution/selling wave. While this is not a buy signal on its own — you need buy volume to confirm — extended sell streaks sometimes precede sharp technical bounces as short sellers cover and bargain hunters enter. Watch for a day where volume spikes AND the price closes above its open.`
          : `${dwnDays} consecutive down days indicates active distribution. Sellers are consistently in control session after session. Avoid trying to catch the bottom until there is a clear break in this pattern.`
      });
    }

    // Fib support map
    insights.push({
      icon: "📐", title: "Key Support Levels to Watch",
      body: `Fibonacci support from GHS ${base.toFixed(2)} → GHS ${peak.toFixed(2)}: 38.2% at GHS ${fib382.toFixed(2)}, 50% at GHS ${fib500.toFixed(2)}, 61.8% (golden ratio) at GHS ${fib618.toFixed(2)}, 78.6% at GHS ${fib786.toFixed(2)}. ${cur < fib618 ? `Price has broken below the golden ratio — this is deep value territory technically, but the lack of buyers means the level hasn't been confirmed as support yet. A close above GHS ${fib618.toFixed(2)} on above-average volume would be the first constructive signal.` : cur < fib500 ? `Price is between the 50% and 61.8% levels. Watch the 61.8% at GHS ${fib618.toFixed(2)} as the next key test.` : cur < fib382 ? `Below the 38.2% level. Next support zones: GHS ${fib500.toFixed(2)} (50%) and GHS ${fib618.toFixed(2)} (61.8%).` : `Price is still above the 38.2% retracement at GHS ${fib382.toFixed(2)} — further downside is likely.`}`
    });

    // Entry recommendation
    insights.push({
      icon: score >= 58 ? "✅" : score >= 44 ? "⏳" : "⛔",
      title: score >= 58 ? "Entry Consideration" : score >= 44 ? "Wait for Confirmation" : "Do Not Enter Yet",
      body: score >= 72
        ? `Price is near strong Fibonacci support and the sell overhang is manageable. Watch for buy orders to appear on the order book — that is your green light. Consider scaling in 25–30% of your intended position now, adding more on confirmation.`
        : score >= 58
        ? `Approaching an interesting level but risk remains. Wait for: (1) buy volume to appear on the order book, (2) a day that closes above its open, (3) the sell overhang shrinking on consecutive sessions. Only then consider a small entry.`
        : score >= 44
        ? `Not yet. Three things must change: (1) buy orders need to reappear at meaningful size, (2) the sell overhang must shrink materially, (3) a day where price gaps up or closes strongly. Set an alert at GHS ${fib618.toFixed(2)} (61.8% fib) and wait for those signals.`
        : `High risk — stay away. ${!hasBuyers ? "Zero buy orders means there is literally no visible floor under this price." : ""} ${isLockLimit ? "A zero-range day where the price simply fell with no buyers is a capitulation signal that may not be finished." : ""} The weight of evidence says to watch from the sidelines. A flush toward GHS ${fib618.toFixed(2)}–GHS ${fib786.toFixed(2)} is possible before any base forms. Missing the first 10–15% of a recovery is far better than catching a falling stock.`
    });

    // Price targets
    insights.push({
      icon: "🎯", title: "Price Targets & Risk Management",
      body: `If entering at GHS ${cur.toFixed(2)}: Stop-loss at GHS ${sl.toFixed(2)} (−7%). Conservative target: GHS ${tp2.toFixed(2)} (38.2% fib recovery, +${((tp2/cur - 1)*100).toFixed(1)}%). Full recovery target: GHS ${tp3.toFixed(2)} (prior peak, +${((tp3/cur - 1)*100).toFixed(1)}%). Risk/reward at conservative target: 1:${Math.max(0, (tp2 - cur) / Math.max(0.01, cur - sl)).toFixed(1)}. Always size your position so that hitting your stop-loss represents a loss you can absorb within your overall portfolio.`
    });
  }

  const fmtN = v => v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inputStyle = { ...S.input, marginBottom: 0 };
  const fieldLabel = txt => <div style={{ ...S.label, marginBottom: 3 }}>{txt}</div>;
  const sectionHdr = txt => <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-accent)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: -2, marginTop: 2 }}>{txt}</div>;
  return (
    <div style={S.root}>
      {/* Header */}
      <div style={{ ...S.header, position: "sticky", top: 0, background: "var(--clr-bg)", zIndex: 10, boxShadow: "0 2px 12px var(--clr-shadow)" }}>
        <div style={{ ...S.row, alignItems: "flex-start" }}>
          <div>
            <div style={S.label}>IC Securities</div>
            <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: -0.5, marginTop: 2 }}>Stock Analysis</div>
          </div>
          <div style={{ display: "flex", gap: "var(--gap-sm)", alignItems: "center", paddingTop: "clamp(4px,1.5vw,8px)" }}>
            <button className="theme-btn" onClick={() => setLightTheme(t => !t)}>{lightTheme ? "🌙" : "☀️"}</button>
            <button className="eye-btn" onClick={() => setHidden(h => !h)}>{hidden ? <EyeOffIcon /> : <EyeIcon />}</button>
          </div>
        </div>
      </div>

      {/* ── INPUT SECTION ── */}
      <div style={{ padding: "var(--gap-md) var(--gutter,18px)", borderBottom: `1px solid var(--clr-border)`, display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

        {/* Row 1: Symbol + Current Price */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap-sm)" }}>
          <div>{fieldLabel("Symbol (optional)")}
            <input style={inputStyle} placeholder="e.g. GCB" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div>{fieldLabel("Current Price (GHS)")}
            <input style={inputStyle} type="number" placeholder="e.g. 27.06" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)} />
          </div>
        </div>

        {/* Row 2: Base + Peak */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap-sm)" }}>
          <div>{fieldLabel("Base / 52W Low (GHS)")}
            <input style={inputStyle} type="number" placeholder="e.g. 7.00" value={basePrice} onChange={e => setBasePrice(e.target.value)} />
          </div>
          <div>{fieldLabel("Peak / 52W High (GHS)")}
            <input style={inputStyle} type="number" placeholder="e.g. 52.00" value={peakPrice} onChange={e => setPeakPrice(e.target.value)} />
          </div>
        </div>

        {/* Row 3: Today's stats — open, high, low, prev close, avg price */}
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-accent)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: -2 }}>Today's Statistics</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--gap-sm)" }}>
          <div>{fieldLabel("Open")}
            <input style={inputStyle} type="number" placeholder="e.g. 30.05" value={openPrice} onChange={e => setOpenPrice(e.target.value)} />
          </div>
          <div>{fieldLabel("High")}
            <input style={inputStyle} type="number" placeholder="e.g. 30.05" value={highPrice} onChange={e => setHighPrice(e.target.value)} />
          </div>
          <div>{fieldLabel("Low")}
            <input style={inputStyle} type="number" placeholder="e.g. 27.06" value={lowPrice} onChange={e => setLowPrice(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap-sm)" }}>
          <div>{fieldLabel("Prev. Close")}
            <input style={inputStyle} type="number" placeholder="e.g. 30.05" value={prevClose} onChange={e => setPrevClose(e.target.value)} />
          </div>
          <div>{fieldLabel("Avg. Price")}
            <input style={inputStyle} type="number" placeholder="e.g. 30.05" value={avgPrice} onChange={e => setAvgPrice(e.target.value)} />
          </div>
        </div>

        {/* Row 4: Order book */}
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-accent)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: -2 }}>Order Book</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "var(--gap-sm)" }}>
          <div>{fieldLabel("Buy Price")}
            <input style={inputStyle} type="number" placeholder="e.g. 0.00" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} />
          </div>
          <div>{fieldLabel("Buy Vol.")}
            <input style={inputStyle} type="number" placeholder="e.g. 0" value={buyVolume} onChange={e => setBuyVolume(e.target.value)} />
          </div>
          <div>{fieldLabel("Sell Price")}
            <input style={inputStyle} type="number" placeholder="e.g. 27.06" value={sellPrice} onChange={e => setSellPrice(e.target.value)} />
          </div>
          <div>{fieldLabel("Sell Vol.")}
            <input style={inputStyle} type="number" placeholder="e.g. 91099" value={sellVolume} onChange={e => setSellVolume(e.target.value)} />
          </div>
        </div>

        {/* Row 5: Volume */}
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-accent)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: -2 }}>Volume</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap-sm)" }}>
          <div>{fieldLabel("Volume Traded Today")}
            <input style={inputStyle} type="number" placeholder="e.g. 21300" value={dailyVolume} onChange={e => setDailyVolume(e.target.value)} />
          </div>
          <div>{fieldLabel("Avg. Daily Vol (optional)")}
            <input style={inputStyle} type="number" placeholder="e.g. 15000" value={avgDailyVol} onChange={e => setAvgDailyVol(e.target.value)} />
          </div>
        </div>

        {!ready && (
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--clr-dim)", textAlign: "center", padding: "var(--gap-sm) 0" }}>
            Fill in Base Price, Peak Price and Current Price to generate analysis.
          </div>
        )}
      </div>

      {/* ── RESULTS ── */}
      {ready && (
        <>
          {/* Verdict hero */}
          <div style={{ ...S.hero, margin: "clamp(8px,2vw,14px) var(--gutter,18px)" }}>
            <div style={{ ...S.row, marginBottom: 10 }}>
              <div>
                <div style={S.label}>{symbol || "Stock"} · Signal</div>
                <span className="signal-badge" style={{ background: verdict.bg, color: verdict.color, marginTop: 6, display: "inline-flex" }}>
                  {verdict.icon} {verdict.label}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", marginBottom: 4 }}>Score</div>
                <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 900, color: verdict.color }}>{score}</div>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)" }}>/100</div>
              </div>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,.08)", overflow: "hidden", marginBottom: 8 }}>
              <div style={{ width: `${score}%`, height: "100%", borderRadius: 5, background: verdict.color, transition: "width .5s ease" }} />
            </div>
            {/* Score factor pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              {[
                [`📐 Fib: ${nearestFib?.label ?? "—"}`,     cur <= fib618 ? "green" : cur <= fib382 ? "gold" : "red"],
                [`📋 Buyers: ${hasBuyers ? "Yes" : "None"}`, hasBuyers ? "green" : "red"],
                [`📊 Overhang: ${daysToAbsorb !== null ? `${Math.round(daysToAbsorb)}d` : "—"}`, daysToAbsorb === null ? "dim" : daysToAbsorb > 30 ? "red" : daysToAbsorb > 10 ? "gold" : "green"],
                ...(prev > 0 ? [[`📉 Day: ${dayChangePct.toFixed(1)}%`, dayChangePct < -5 ? "red" : dayChangePct < 0 ? "gold" : "green"]] : []),
              ].map(([label, tone]) => (
                <span key={label} style={{ fontSize: "var(--fs-xs)", fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                  background: tone === "green" ? "rgba(0,200,83,.15)" : tone === "red" ? "rgba(245,34,45,.15)" : tone === "gold" ? "rgba(245,166,35,.15)" : "rgba(140,155,176,.15)",
                  color: tone === "green" ? "var(--clr-green)" : tone === "red" ? "var(--clr-red)" : tone === "gold" ? "var(--clr-gold)" : "var(--clr-dim)" }}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Key metrics */}
          <div className="section-label">Key Metrics</div>
          <div>
            {[
              ["Total Rally",        `+${rallyPct.toFixed(1)}%  (GHS ${fmtN(base)} → GHS ${fmtN(peak)})`,  "var(--clr-green)"],
              ["Drawdown from Peak", `−${drawdownPct.toFixed(1)}%  (GHS ${fmtN(peak)} → GHS ${fmtN(cur)})`, "var(--clr-red)"],
              ["Still up from Base", `+${gainFromBasePct.toFixed(1)}%  (+GHS ${fmtN(gainFromBase)})`,        "var(--clr-green)"],
              ...(prev > 0 ? [["Day Change", `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%  (${dayChange >= 0 ? "+" : ""}GHS ${fmtN(Math.abs(dayChange))})`, dayChangePct >= 0 ? "var(--clr-green)" : "var(--clr-red)"]] : []),
              ...(rangePosition !== null ? [["In Day Range", `${rangePosition.toFixed(0)}% of range  (Low ${fmtN(low)} – High ${fmtN(high)})`, rangePosition > 60 ? "var(--clr-green)" : rangePosition < 30 ? "var(--clr-red)" : "var(--clr-gold)"]] : []),
              ...(daysToAbsorb !== null ? [["Days to Clear Sell Wall", `~${Math.round(daysToAbsorb)} days  (${overhangMult}× today's vol)`, daysToAbsorb > 50 ? "var(--clr-red)" : daysToAbsorb > 20 ? "var(--clr-gold)" : "var(--clr-green)"]] : []),
              ...(orderImbalance !== null ? [["Order Book Imbalance", `${orderImbalance.toFixed(0)}% sell-heavy  (${buySellRatio.toFixed(2)} buy/sell ratio)`, orderImbalance > 60 ? "var(--clr-red)" : orderImbalance > 20 ? "var(--clr-gold)" : "var(--clr-green)"]] : []),
              ...(volRatio !== null ? [["Volume vs Average", `${(volRatio * 100).toFixed(0)}% of avg  (${volRatio >= 1 ? "+" : ""}${((volRatio - 1) * 100).toFixed(0)}%)`, volRatio >= 1.2 ? "var(--clr-green)" : volRatio < 0.7 ? "var(--clr-red)" : "var(--clr-gold)"]] : []),
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="analysis-metric">
                <span className="analysis-metric-label">{lbl}</span>
                <span className="analysis-metric-value" style={{ color: clr }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Order book snapshot */}
          {(buyVol > 0 || sellVol > 0 || buyPx > 0 || sellPx > 0) && (
            <>
              <div className="section-label" style={{ marginTop: "var(--gap-md)" }}>Order Book Snapshot</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid var(--clr-border)", borderBottom: "1px solid var(--clr-border)" }}>
                {/* Buy side */}
                <div style={{ padding: "clamp(12px,3vw,16px) var(--gutter,18px)", borderRight: "1px solid var(--clr-border)", background: hasBuyers ? "rgba(0,200,83,.05)" : "rgba(245,34,45,.03)" }}>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Buy Side</div>
                  <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, color: hasBuyers ? "var(--clr-green)" : "var(--clr-dim)" }}>{buyPx > 0 ? `GHS ${fmtN(buyPx)}` : "0.00"}</div>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--clr-dim)", marginTop: 4 }}>{buyVol > 0 ? `${buyVol.toLocaleString()} shares` : "No buyers"}</div>
                  {!hasBuyers && <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-red)", fontWeight: 700, marginTop: 6 }}>⚠ Zero bids</div>}
                </div>
                {/* Sell side */}
                <div style={{ padding: "clamp(12px,3vw,16px) var(--gutter,18px)", background: sellVol > 0 ? "rgba(245,34,45,.05)" : "var(--clr-card)" }}>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Sell Side</div>
                  <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, color: sellVol > 0 ? "var(--clr-red)" : "var(--clr-dim)" }}>{sellPx > 0 ? `GHS ${fmtN(sellPx)}` : "—"}</div>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--clr-dim)", marginTop: 4 }}>{sellVol > 0 ? `${sellVol.toLocaleString()} shares` : "No sellers"}</div>
                  {spread !== null && <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", marginTop: 6 }}>Spread: GHS {fmtN(spread)} ({spreadPct?.toFixed(2)}%)</div>}
                </div>
              </div>
              {/* Visual imbalance bar */}
              {orderImbalance !== null && (
                <div style={{ padding: "clamp(8px,2vw,10px) var(--gutter,18px)", background: "var(--clr-card)", borderBottom: "1px solid var(--clr-border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: "var(--fs-xs)", color: "var(--clr-dim)" }}>
                    <span style={{ color: "var(--clr-green)" }}>Buy {buyVol > 0 ? ((buyVol/(buyVol+sellVol))*100).toFixed(0) : 0}%</span>
                    <span>Order Imbalance</span>
                    <span style={{ color: "var(--clr-red)" }}>Sell {sellVol > 0 ? ((sellVol/(buyVol+sellVol))*100).toFixed(0) : 0}%</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--clr-red)", overflow: "hidden" }}>
                    <div style={{ width: `${buyVol > 0 ? (buyVol/(buyVol+sellVol))*100 : 0}%`, height: "100%", background: "var(--clr-green)", borderRadius: 4 }} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Fibonacci levels */}
          <div className="section-label" style={{ marginTop: "var(--gap-md)" }}>Fibonacci Retracement Levels</div>
          <div>
            {fibLevels.map(f => {
              const dist = Math.abs(f.price - cur);
              const isCurrent = dist === Math.min(...fibLevels.map(x => Math.abs(x.price - cur)));
              const isBelow = cur <= f.price;
              return (
                <div key={f.label} className="fib-row"
                  style={{ background: isCurrent ? "rgba(245,166,35,.08)" : f.ratio === 0.618 ? "rgba(45,127,249,.04)" : "var(--clr-card)", borderLeft: isCurrent ? "3px solid var(--clr-gold)" : f.ratio === 0.618 ? "3px solid rgba(45,127,249,.4)" : "3px solid transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                    <span style={{ fontWeight: 800, fontSize: "var(--fs-sm)", color: f.ratio === 0.618 ? "var(--clr-accent)" : isCurrent ? "var(--clr-gold)" : "var(--clr-dim)", minWidth: 44 }}>{f.label}</span>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)" }}>
                      {f.ratio === 0 ? "Base" : f.ratio === 0.236 ? "Minor" : f.ratio === 0.382 ? "Key support" : f.ratio === 0.5 ? "Mid support" : f.ratio === 0.618 ? "Golden ratio ★" : f.ratio === 0.786 ? "Deep support" : "Full retrace"}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: "var(--fs-md)" }}>GHS {fmtN(f.price)}</div>
                    {isCurrent
                      ? <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-gold)", fontWeight: 700 }}>◀ nearest</div>
                      : <div style={{ fontSize: "var(--fs-xs)", color: isBelow ? "var(--clr-green)" : "var(--clr-red)" }}>{isBelow ? "▲ above" : "▼ below"} {dist < 1 ? `(GHS ${fmtN(dist)})` : ""}</div>
                    }
                  </div>
                </div>
              );
            })}
          </div>

          {/* Insights */}
          <div className="section-label" style={{ marginTop: "var(--gap-md)" }}>Analysis & Insights</div>
          {insights.map((ins, i) => (
            <div key={i} className="insight-card">
              <div className="insight-title">{ins.icon} {ins.title}</div>
              <div className="insight-body">{ins.body}</div>
            </div>
          ))}

          {/* Disclaimer */}
          <div style={{ padding: "clamp(12px,3vw,16px) var(--gutter,18px)", fontSize: "var(--fs-xs)", color: "var(--clr-dim)", lineHeight: 1.65, borderTop: "1px solid var(--clr-border)", marginTop: "var(--gap-md)" }}>
            ⚠️ This analysis uses technical indicators only and is for informational purposes. It does not constitute financial advice. Always do your own research and consider your risk tolerance before investing.
          </div>
        </>
      )}
    </div>
  );
}

// ─── Bottom Navigation ────────────────────────────────────────────────────────
function BottomNav({ tab, setTab }) {
  const items = [
    { id: "stocks",      label: "Stocks",   icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
    { id: "tbills",      label: "T-Bills",  icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg> },
    { id: "mutualfunds", label: "Funds",    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> },
    { id: "summary",     label: "Summary",  icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
    { id: "analyse",     label: "Analyse",  icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> },
  ];
  return (
    <nav className="bottom-nav">
      {items.map(it => (
        <button key={it.id} className={`nav-item${tab === it.id ? " active" : ""}`} onClick={() => setTab(it.id)}>
          {it.icon}
          {it.label}
        </button>
      ))}
    </nav>
  );
}


// ─── T-Bills Screen ───────────────────────────────────────────────────────────
// ─── T-Bill Calculator ────────────────────────────────────────────────────────
function TBillCalculator({ onClose }) {
  const [capital,   setCapital]   = useState("");
  const [duration,  setDuration]  = useState("91");
  const [rate91,    setRate91]    = useState("");
  const [rate182,   setRate182]   = useState("");
  const [rate364,   setRate364]   = useState("");
  const [rollovers, setRollovers] = useState("1");

  // Current rate field based on selected duration
  const rateVal = duration === "91" ? rate91 : duration === "182" ? rate182 : rate364;
  const setRateVal = v => {
    if (duration === "91")  setRate91(v);
    else if (duration === "182") setRate182(v);
    else setRate364(v);
  };

  // Per-period divisor
  const divisor = duration === "91" ? 4 : duration === "182" ? 2 : 1;
  const periods  = parseInt(rollovers) || 1;
  const p        = parseFloat(capital) || 0;
  const r        = parseFloat(rateVal) || 0;

  // Traditional T-Bill formula per period:
  //   interest  = principal × (rate / 100) / divisor
  //   maturity  = principal + interest
  // For rollovers: each period the maturity amount becomes the new principal
  const rolloverRows = [];
  let runningPrincipal = p;
  for (let i = 0; i < periods; i++) {
    const interest  = (runningPrincipal * r / 100) / divisor;
    const maturity  = runningPrincipal + interest;
    rolloverRows.push({ period: i + 1, principal: runningPrincipal, interest, maturity });
    runningPrincipal = maturity; // reinvest full amount each rollover
  }
  const totalInterest  = runningPrincipal - p;
  const totalMaturity  = runningPrincipal;
  const effectiveYield = p > 0 ? (totalInterest / p) * 100 : 0;

  const fmtN = v => v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inputStyle = { ...S.input, marginBottom: 0 };
  const selBtnStyle = (active) => ({
    flex: 1, padding: "clamp(9px,2.5vw,12px) 6px", borderRadius: 10,
    border: `1px solid ${active ? "var(--clr-accent)" : "var(--clr-border)"}`,
    background: active ? "rgba(45,127,249,.15)" : "var(--clr-input-bg)",
    color: active ? "var(--clr-accent)" : "var(--clr-text)",
    fontWeight: 700, cursor: "pointer", fontSize: "var(--fs-sm)",
    fontFamily: "'Brighter Sans', sans-serif",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60,
      background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end",
      justifyContent: "center",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: "100%", maxWidth: 640,
        background: "var(--clr-card-alt)",
        borderTopLeftRadius: "var(--radius-sheet)", borderTopRightRadius: "var(--radius-sheet)",
        padding: "clamp(18px,5vw,28px) var(--gutter,18px) max(env(safe-area-inset-bottom,20px),36px)",
        maxHeight: "92dvh", overflowY: "auto",
        border: "1px solid var(--clr-border)",
        boxShadow: "0 -8px 40px var(--clr-sheet-shadow)",
      }}>
        {/* Header */}
        <div style={{ ...S.row, marginBottom: "var(--gap-md)" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: "var(--fs-lg)" }}>🧮 T-Bill Calculator</div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", marginTop: 2 }}>Traditional formula with rollover support</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--clr-dim)", fontSize: "var(--fs-xl)", cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* Capital */}
        <div style={S.label}>Capital to Invest (GHS)</div>
        <input style={{ ...inputStyle, marginBottom: "var(--gap-md)" }} type="number" placeholder="e.g. 10000"
          value={capital} onChange={e => setCapital(e.target.value)} />

        {/* Duration selector */}
        <div style={S.label}>T-Bill Type</div>
        <div style={{ display: "flex", gap: "var(--gap-sm)", marginBottom: "var(--gap-md)" }}>
          {[["91","91-Day"],["182","182-Day"],["364","364-Day"]].map(([v, lbl]) => (
            <button key={v} style={selBtnStyle(duration === v)} onClick={() => setDuration(v)}>{lbl}</button>
          ))}
        </div>

        {/* Rate inputs — all three visible so user can prefill all and switch */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--gap-sm)", marginBottom: "var(--gap-md)" }}>
          {[["91", rate91, setRate91], ["182", rate182, setRate182], ["364", rate364, setRate364]].map(([d, val, setter]) => (
            <div key={d}>
              <div style={{ ...S.label, marginBottom: 4 }}>{d}-Day Rate %</div>
              <input style={{ ...inputStyle, border: `1px solid ${duration === d ? "var(--clr-accent)" : "var(--clr-border)"}`, background: duration === d ? "rgba(45,127,249,.06)" : "var(--clr-input-bg)" }}
                type="number" placeholder="e.g. 28.5"
                value={val} onChange={e => setter(e.target.value)} />
            </div>
          ))}
        </div>

        {/* Number of rollovers */}
        <div style={S.label}>Number of Rollovers (investment periods)</div>
        <div style={{ display: "flex", gap: "var(--gap-sm)", marginBottom: "var(--gap-md)" }}>
          {["1","2","3","4","6","8"].map(v => (
            <button key={v} style={{ ...selBtnStyle(rollovers === v), flex: "unset", minWidth: "clamp(34px,8vw,44px)", padding: "clamp(7px,2vw,10px) 6px" }}
              onClick={() => setRollovers(v)}>{v}</button>
          ))}
          <input style={{ ...inputStyle, flex: 1, marginBottom: 0, textAlign: "center" }} type="number"
            min="1" max="52" placeholder="or type"
            value={["1","2","3","4","6","8"].includes(rollovers) ? "" : rollovers}
            onChange={e => setRollovers(e.target.value)} />
        </div>

        {/* Results */}
        {p > 0 && r > 0 && (
          <>
            {/* Summary hero */}
            <div style={{ background: "rgba(0,200,83,.07)", border: "1px solid rgba(0,200,83,.2)", borderRadius: 12, padding: "clamp(12px,3vw,16px)", marginBottom: "var(--gap-md)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
                {[
                  ["Capital",         `GHS ${fmtN(p)}`,             "var(--clr-text)"],
                  ["Total Interest",  `+GHS ${fmtN(totalInterest)}`, "var(--clr-green)"],
                  ["You Receive",     `GHS ${fmtN(totalMaturity)}`,  "var(--clr-text)"],
                  ["Periods",         `${periods} × ${duration}d`,   "var(--clr-gold)"],
                  ["Eff. Yield",      `${effectiveYield.toFixed(3)}%`,"var(--clr-accent)"],
                  ["Per Period",      `+GHS ${fmtN(rolloverRows[0]?.interest ?? 0)}`, "var(--clr-green)"],
                ].map(([lbl, val, clr]) => (
                  <div key={lbl} style={{ padding: "8px 4px" }}>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 4 }}>{lbl}</div>
                    <div style={{ fontWeight: 800, fontSize: "var(--fs-base)", color: clr }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rollover breakdown table */}
            {periods > 1 && (
              <>
                <div style={{ ...S.label, marginBottom: 8 }}>Rollover Breakdown</div>
                <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--clr-border)", marginBottom: "var(--gap-md)" }}>
                  {/* Table header */}
                  <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr 1fr", background: "var(--clr-card)", borderBottom: "1px solid var(--clr-border)", padding: "clamp(6px,1.5vw,9px) clamp(8px,2vw,12px)" }}>
                    {["#", "Principal", "Interest", "Maturity"].map(h => (
                      <div key={h} style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.3, textTransform: "uppercase", textAlign: h === "#" ? "center" : "right" }}>{h}</div>
                    ))}
                  </div>
                  {rolloverRows.map(row => (
                    <div key={row.period} style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr 1fr", padding: "clamp(8px,2vw,11px) clamp(8px,2vw,12px)", borderBottom: "1px solid var(--clr-border)", background: row.period % 2 === 0 ? "var(--clr-card)" : "var(--clr-bg)" }}>
                      <div style={{ textAlign: "center", fontWeight: 700, color: "var(--clr-gold)", fontSize: "var(--fs-sm)" }}>{row.period}</div>
                      <div style={{ textAlign: "right", fontSize: "var(--fs-sm)", color: "var(--clr-dim)" }}>{fmtN(row.principal)}</div>
                      <div style={{ textAlign: "right", fontSize: "var(--fs-sm)", color: "var(--clr-green)", fontWeight: 600 }}>+{fmtN(row.interest)}</div>
                      <div style={{ textAlign: "right", fontSize: "var(--fs-sm)", fontWeight: 700 }}>{fmtN(row.maturity)}</div>
                    </div>
                  ))}
                  {/* Totals row */}
                  <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr 1fr", padding: "clamp(8px,2vw,11px) clamp(8px,2vw,12px)", background: "rgba(0,200,83,.07)", borderTop: "2px solid rgba(0,200,83,.25)" }}>
                    <div style={{ textAlign: "center", fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1 }}>TOT</div>
                    <div style={{ textAlign: "right", fontSize: "var(--fs-sm)", color: "var(--clr-dim)" }}>{fmtN(p)}</div>
                    <div style={{ textAlign: "right", fontSize: "var(--fs-sm)", color: "var(--clr-green)", fontWeight: 800 }}>+{fmtN(totalInterest)}</div>
                    <div style={{ textAlign: "right", fontSize: "var(--fs-sm)", fontWeight: 800 }}>{fmtN(totalMaturity)}</div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Empty state hint */}
        {(p === 0 || r === 0) && (
          <div style={{ textAlign: "center", color: "var(--clr-dim)", fontSize: "var(--fs-sm)", padding: "var(--gap-md) 0" }}>
            Enter a capital amount and interest rate to see results.
          </div>
        )}
      </div>
    </div>
  );
}


function TBillsScreen({ tbills, hidden, tbillSheet, setTbillSheet, editingTbill, setEditingTbill,
  tbForm, setTbForm, saveTbill, deleteTbill, lightTheme, setLightTheme, setHidden }) {
  const [showCalc, setShowCalc] = useState(false);
  const totalInvested  = tbills.reduce((s, x) => s + x.principal, 0);
  const totalMaturity  = tbills.reduce((s, x) => s + x.maturityAmount, 0);
  const totalEarnings  = totalMaturity - totalInvested;
  return (
    <div style={S.root}>
      {showCalc && <TBillCalculator onClose={() => setShowCalc(false)} />}
      <div style={S.header}>
        <div style={{ ...S.row, alignItems: "flex-start" }}>
          <div>
            <div style={S.label}>IC Securities</div>
            <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: -0.5, marginTop: 2 }}>Treasury Bills</div>
          </div>
          <div style={{ display: "flex", gap: "var(--gap-sm)", alignItems: "center", paddingTop: "clamp(4px,1.5vw,8px)" }}>
            <button className="theme-btn" onClick={() => setLightTheme(t => !t)}>{lightTheme ? "🌙" : "☀️"}</button>
            <button className="eye-btn" onClick={() => setHidden(h => !h)}>{hidden ? <EyeOffIcon /> : <EyeIcon />}</button>
            <button onClick={() => setShowCalc(true)}
              style={{ background: "rgba(45,127,249,.12)", border: "1px solid rgba(45,127,249,.25)", color: "var(--clr-accent)", borderRadius: 10, padding: "clamp(5px,1.5vw,7px) clamp(9px,2.5vw,12px)", fontWeight: 700, fontSize: "var(--fs-sm)", cursor: "pointer", fontFamily: "'Brighter Sans', sans-serif", whiteSpace: "nowrap" }}>
              🧮 Calc
            </button>
          </div>
        </div>
      </div>
      <div style={S.hero}>
        <div style={S.label}>Total Invested</div>
        <div style={S.bigNum}>{hidden ? "••••••" : `GHS ${totalInvested.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}</div>
        <div style={{ display: "flex", gap: "clamp(16px,4vw,28px)", marginTop: "clamp(10px,2.8vw,16px)" }}>
          <div><div style={S.label}>Expected Returns</div>
            <div style={{ color: hidden ? "var(--clr-dim)" : "var(--clr-green)", fontWeight: 700, fontSize: "var(--fs-xl)" }}>
              {hidden ? "••••" : `+GHS ${totalEarnings.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}
            </div>
          </div>
          <div><div style={S.label}>Maturity Total</div>
            <div style={{ fontWeight: 700, fontSize: "var(--fs-xl)" }}>
              {hidden ? "••••" : `GHS ${totalMaturity.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}
            </div>
          </div>
        </div>
      </div>
      {tbills.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--clr-dim)", marginTop: "clamp(40px,10vw,72px)", fontSize: "var(--fs-md)", lineHeight: 1.8 }}>
          No treasury bills yet.<br/>Tap <strong style={{ color: "var(--clr-accent)" }}>+</strong> to add one.
        </div>
      )}
      {tbills.length > 0 && <div className="section-label">Holdings · {tbills.length} bill{tbills.length !== 1 ? "s" : ""}</div>}
      <div className="holdings-list">
        {tbills.map(tb => {
          const earnings = tb.maturityAmount - tb.principal;
          return (
            <div key={tb.id} className="inv-card">
              <div className="inv-row" style={{ marginBottom: "var(--gap-sm)" }}>
                <div>
                  <div className="inv-card-title">{tb.label}</div>
                  {tb.maturityDate && <div className="inv-card-sub">Matures {tb.maturityDate}</div>}
                </div>
                <div style={{ display: "flex", gap: "var(--gap-sm)" }}>
                  <button className="update-price-btn" style={{ fontSize: "var(--fs-xs)", padding: "5px 10px" }}
                    onClick={() => { setEditingTbill(tb); setTbForm({ label: tb.label, principal: tb.principal, rate: tb.rate, maturityDate: tb.maturityDate || "", duration: tb.duration || "91" }); setTbillSheet(true); }}>Edit</button>
                  <button className="remove-btn" style={{ fontSize: "var(--fs-xs)", padding: "5px 10px" }} onClick={() => deleteTbill(tb.id)}>Remove</button>
                </div>
              </div>
              <div className="inv-stat-grid">
                {[
                  ["Duration",      `${tb.duration || 91} days`],
                  ["Rate",          `${tb.rate}%`],
                  ["Invested",      hidden ? "••••••" : `GHS ${tb.principal.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`],
                  ["Interest Earned", hidden ? "••••" : `+GHS ${(tb.interest ?? tb.maturityAmount - tb.principal).toLocaleString("en-GH", { minimumFractionDigits: 2 })}`],
                  ["Maturity Amt",  hidden ? "••••••" : `GHS ${tb.maturityAmount.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`],
                ].map(([lbl, val], i) => (
                  <div key={i} className="inv-stat">
                    <div className="inv-stat-label">{lbl}</div>
                    <div className="inv-stat-value" style={{ color: lbl === "Interest Earned" ? "var(--clr-green)" : lbl === "Rate" ? "var(--clr-accent)" : lbl === "Duration" ? "var(--clr-gold)" : "var(--clr-text)" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {tbillSheet && (
        <div className="bottom-sheet">
          <div className="sheet-title">{editingTbill ? "Edit T-Bill" : "Add Treasury Bill"}</div>

          <div style={S.label}>Duration</div>
          <div style={{ display: "flex", gap: "var(--gap-sm)", marginBottom: "var(--gap-sm)" }}>
            {[["91", "91-Day"], ["182", "182-Day"], ["364", "364-Day"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setTbForm(f => ({ ...f, duration: val }))}
                style={{ flex: 1, padding: "clamp(9px,2.5vw,12px) 8px", borderRadius: 10, border: `1px solid ${tbForm.duration === val ? "var(--clr-accent)" : "var(--clr-border)"}`, background: tbForm.duration === val ? "rgba(45,127,249,.15)" : "var(--clr-input-bg)", color: tbForm.duration === val ? "var(--clr-accent)" : "var(--clr-text)", fontWeight: 700, cursor: "pointer", fontSize: "var(--fs-base)", fontFamily: "'Brighter Sans', sans-serif" }}>
                {lbl}
              </button>
            ))}
          </div>

          {[["Label (optional)", "label", "e.g. Batch 1", "text"],
            ["Principal Amount (GHS)", "principal", "e.g. 5000", "number"],
            ["Interest Rate (%)", "rate", "e.g. 28.5", "number"],
            ["Maturity Date (optional)", "maturityDate", "e.g. 2026-06-01", "text"]
          ].map(([lbl, key, ph, type]) => (
            <div key={key}>
              <div style={S.label}>{lbl}</div>
              <input style={S.input} type={type} placeholder={ph} value={tbForm[key]}
                onChange={e => setTbForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}

          {tbForm.principal && tbForm.rate && (() => {
            const p = parseFloat(tbForm.principal), r = parseFloat(tbForm.rate);
            if (isNaN(p) || isNaN(r)) return null;
            const divisor  = tbForm.duration === "91" ? 4 : tbForm.duration === "182" ? 2 : 1;
            const interest = (p * r / 100) / divisor;
            const maturity = p + interest;
            return (
              <div style={{ background: "rgba(0,200,83,.07)", border: "1px solid rgba(0,200,83,.2)", borderRadius: 10, padding: "clamp(10px,2.8vw,14px)", marginBottom: "var(--gap-sm)" }}>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>Preview</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)" }}>Interest Earned</div>
                    <div style={{ fontWeight: 700, color: "var(--clr-green)", fontSize: "var(--fs-md)" }}>+GHS {interest.toLocaleString("en-GH", { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)" }}>You Receive</div>
                    <div style={{ fontWeight: 700, fontSize: "var(--fs-md)" }}>GHS {maturity.toLocaleString("en-GH", { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="btn-pair" style={{ marginTop: "var(--gap-sm)" }}>
            <button style={{ ...S.btn, background: "var(--clr-card)", marginTop: 0 }}
              onClick={() => { setTbillSheet(false); setEditingTbill(null); setTbForm({ label: "", principal: "", rate: "", maturityDate: "", duration: "91" }); }}>Cancel</button>
            <button style={{ ...S.btn, marginTop: 0 }} onClick={saveTbill}>Save</button>
          </div>
        </div>
      )}
      <button className="fab-btn" onClick={() => { setEditingTbill(null); setTbForm({ label: "", principal: "", rate: "", maturityDate: "", duration: "91" }); setTbillSheet(true); }}>+</button>
    </div>
  );
}

// ─── Mutual Funds Screen ──────────────────────────────────────────────────────
function MutualFundsScreen({ mfunds, hidden, mfSheet, setMfSheet, editingMF, setEditingMF,
  mfForm, setMfForm, saveMF, deleteMF, mfEntrySheet, setMfEntrySheet,
  mfEntryForm, setMfEntryForm, saveMFEntry, deleteMFEntry, showMFPct, setShowMFPct,
  lightTheme, setLightTheme, setHidden }) {
  const totalPrincipal = mfunds.reduce((s, x) => s + (x.principal || 0), 0);
  const totalInterest  = mfunds.reduce((s, f) => s + (f.entries || []).reduce((a, e) => a + e.interest, 0), 0);
  const latestMaturity = mfunds.reduce((s, f) => {
    const entries = f.entries || [];
    if (!entries.length) return s + (f.principal || 0);
    return s + entries[entries.length - 1].maturityAmount;
  }, 0);
  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ ...S.row, alignItems: "flex-start" }}>
          <div>
            <div style={S.label}>IC Securities</div>
            <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: -0.5, marginTop: 2 }}>Mutual Funds</div>
          </div>
          <div style={{ display: "flex", gap: "var(--gap-sm)", alignItems: "center", paddingTop: "clamp(4px,1.5vw,8px)" }}>
            <button className="theme-btn" onClick={() => setLightTheme(t => !t)}>{lightTheme ? "🌙" : "☀️"}</button>
            <button className="eye-btn" onClick={() => setHidden(h => !h)}>{hidden ? <EyeOffIcon /> : <EyeIcon />}</button>
          </div>
        </div>
      </div>
      <div style={S.hero}>
        <div style={S.label}>Total Invested</div>
        <div style={S.bigNum}>{hidden ? "••••••" : `GHS ${totalPrincipal.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}</div>
        <div style={{ display: "flex", gap: "clamp(16px,4vw,28px)", marginTop: "clamp(10px,2.8vw,16px)" }}>
          <div><div style={S.label}>Total Interest Earned</div>
            <div style={{ color: hidden ? "var(--clr-dim)" : "var(--clr-green)", fontWeight: 700, fontSize: "var(--fs-xl)" }}>
              {hidden ? "••••" : `+GHS ${totalInterest.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}
            </div>
          </div>
          <div><div style={S.label}>Latest Maturity</div>
            <div style={{ fontWeight: 700, fontSize: "var(--fs-xl)" }}>
              {hidden ? "••••" : `GHS ${latestMaturity.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}
            </div>
          </div>
        </div>
      </div>
      {mfunds.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--clr-dim)", marginTop: "clamp(40px,10vw,72px)", fontSize: "var(--fs-md)", lineHeight: 1.8 }}>
          No mutual funds yet.<br/>Tap <strong style={{ color: "var(--clr-accent)" }}>+</strong> to add one.
        </div>
      )}
      {mfunds.map(fund => {
        const entries   = fund.entries || [];
        const totalInt  = entries.reduce((s, e) => s + e.interest, 0);
        const lastEntry = entries[entries.length - 1];
        const intPct    = fund.principal ? (totalInt / fund.principal) * 100 : 0;
        return (
          <div key={fund.id}>
            <div className="inv-card">
              <div className="inv-row" style={{ marginBottom: "var(--gap-sm)" }}>
                <div>
                  <div className="inv-card-title">{fund.name}</div>
                  <div className="inv-card-sub">{entries.length} daily entr{entries.length === 1 ? "y" : "ies"}</div>
                </div>
                <div style={{ display: "flex", gap: "var(--gap-sm)", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="update-price-btn" style={{ fontSize: "var(--fs-xs)", padding: "5px 10px" }}
                    onClick={() => { setMfEntryForm({ date: "", interest: "", maturityAmount: "" }); setMfEntrySheet(fund.id); }}>+ Entry</button>
                  <button className="update-price-btn" style={{ fontSize: "var(--fs-xs)", padding: "5px 10px", background: "var(--clr-card)", color: "var(--clr-accent)", border: "1px solid var(--clr-accent)" }}
                    onClick={() => { setEditingMF(fund); setMfForm({ name: fund.name, principal: fund.principal }); setMfSheet(true); }}>Edit</button>
                  <button className="remove-btn" style={{ fontSize: "var(--fs-xs)", padding: "5px 10px" }} onClick={() => deleteMF(fund.id)}>Remove</button>
                </div>
              </div>
              <div className="inv-stat-grid">
                {[
                  ["Principal",       hidden ? "••••••" : `GHS ${(fund.principal||0).toLocaleString("en-GH",{minimumFractionDigits:2})}`],
                  ["Total Interest",  hidden ? "••••"   : `+GHS ${totalInt.toLocaleString("en-GH",{minimumFractionDigits:2})}`],
                  ["Interest %",      `${intPct.toFixed(3)}%`],
                  ["Latest Maturity", hidden ? "••••••" : (lastEntry ? `GHS ${lastEntry.maturityAmount.toLocaleString("en-GH",{minimumFractionDigits:2})}` : "—")],
                ].map(([lbl, val], i) => (
                  <div key={i} className="inv-stat">
                    <div className="inv-stat-label">{lbl}</div>
                    <div className="inv-stat-value" style={{ color: lbl==="Total Interest" ? "var(--clr-green)" : lbl==="Interest %" ? "var(--clr-accent)" : "var(--clr-text)" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
            {entries.length > 0 && (
              <>
                <div className="section-label">{fund.name} · Daily Entries</div>
                {[...entries].reverse().map((entry, ri) => {
                  const idx    = entries.length - 1 - ri;
                  const pctKey = `${fund.id}_${idx}`;
                  const pctVal = fund.principal ? (entry.interest / fund.principal) * 100 : 0;
                  return (
                    <div key={idx} className="mf-entry-row">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "var(--fs-base)" }}>{entry.date}</div>
                        <div style={{ fontSize: "var(--fs-sm)", color: "var(--clr-dim)", marginTop: 2 }}>
                          Maturity: {hidden ? "••••••" : `GHS ${entry.maturityAmount.toLocaleString("en-GH",{minimumFractionDigits:2})}`}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                        <div style={{ ...S.pill(entry.interest), cursor: "pointer" }}
                          onClick={() => setShowMFPct(p => ({ ...p, [pctKey]: !p[pctKey] }))}>
                          {hidden ? "••••" : showMFPct[pctKey]
                            ? `+${pctVal.toFixed(4)}%`
                            : `+GHS ${entry.interest.toLocaleString("en-GH",{minimumFractionDigits:2})}`}
                        </div>
                        <button className="remove-btn" style={{ fontSize: "var(--fs-xs)", padding: "4px 8px" }} onClick={() => deleteMFEntry(fund.id, idx)}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
      {mfSheet && (
        <div className="bottom-sheet">
          <div className="sheet-title">{editingMF ? "Edit Fund" : "Add Mutual Fund"}</div>
          {[["Fund Name","name","e.g. EDC Balanced Fund","text"],["Principal Amount (GHS)","principal","e.g. 10000","number"]].map(([lbl,key,ph,type]) => (
            <div key={key}>
              <div style={S.label}>{lbl}</div>
              <input style={S.input} type={type} placeholder={ph} value={mfForm[key]} onChange={e => setMfForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="btn-pair" style={{ marginTop: "var(--gap-sm)" }}>
            <button style={{ ...S.btn, background: "var(--clr-card)", marginTop: 0 }} onClick={() => { setMfSheet(false); setEditingMF(null); setMfForm({ name: "", principal: "" }); }}>Cancel</button>
            <button style={{ ...S.btn, marginTop: 0 }} onClick={saveMF}>Save</button>
          </div>
        </div>
      )}
      {mfEntrySheet && (
        <div className="bottom-sheet">
          <div className="sheet-title">Add Daily Entry</div>
          {[["Date","date",today(),"text"],["Daily Interest Earned (GHS)","interest","e.g. 12.50","number"],["Maturity Amount (GHS)","maturityAmount","e.g. 10012.50","number"]].map(([lbl,key,ph,type]) => (
            <div key={key}>
              <div style={S.label}>{lbl}</div>
              <input style={S.input} type={type} placeholder={ph} value={mfEntryForm[key]} onChange={e => setMfEntryForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="btn-pair" style={{ marginTop: "var(--gap-sm)" }}>
            <button style={{ ...S.btn, background: "var(--clr-card)", marginTop: 0 }} onClick={() => { setMfEntrySheet(null); setMfEntryForm({ date: "", interest: "", maturityAmount: "" }); }}>Cancel</button>
            <button style={{ ...S.btn, marginTop: 0 }} onClick={saveMFEntry}>Save</button>
          </div>
        </div>
      )}
      <button className="fab-btn" onClick={() => { setEditingMF(null); setMfForm({ name: "", principal: "" }); setMfSheet(true); }}>+</button>
    </div>
  );
}

// ─── Summary Screen ───────────────────────────────────────────────────────────
function SummaryScreen({ portfolio, tbills, mfunds, hidden, setHidden, lightTheme, setLightTheme }) {
  const stocks         = Object.values(portfolio);
  const stocksValue    = stocks.reduce((s, x) => s + (x.currentPrice !== null ? x.currentPrice * x.totalShares : x.totalCost), 0);
  const stocksInvested = stocks.reduce((s, x) => s + x.totalCost, 0);
  const stocksPnl      = stocksValue - stocksInvested;
  const tbInvested     = tbills.reduce((s, x) => s + x.principal, 0);
  const tbMaturity     = tbills.reduce((s, x) => s + x.maturityAmount, 0);
  const tbEarnings     = tbMaturity - tbInvested;
  const mfPrincipal    = mfunds.reduce((s, x) => s + (x.principal || 0), 0);
  const mfInterest     = mfunds.reduce((s, f) => s + (f.entries || []).reduce((a, e) => a + e.interest, 0), 0);
  const mfLatest       = mfunds.reduce((s, f) => {
    const entries = f.entries || [];
    if (!entries.length) return s + (f.principal || 0);
    return s + entries[entries.length - 1].maturityAmount;
  }, 0);
  const totalInvested  = stocksInvested + tbInvested + mfPrincipal;
  const totalValue     = stocksValue + tbMaturity + mfLatest;
  const totalEarnings  = totalValue - totalInvested;
  const totalEarnPct   = totalInvested ? (totalEarnings / totalInvested) * 100 : 0;
  const fmtPlain = v => `GHS ${Math.abs(v).toLocaleString("en-GH", { minimumFractionDigits: 2 })}`;
  const tiles = [
    { icon: "📈", label: "Stocks Value",     value: fmtPlain(stocksValue),  sub: `${stocksPnl >= 0 ? "+" : ""}GHS ${Math.abs(stocksPnl).toLocaleString("en-GH",{minimumFractionDigits:2})} P&L`, subColor: col(stocksPnl) },
    { icon: "🏦", label: "T-Bills Maturity", value: fmtPlain(tbMaturity),   sub: tbInvested ? `+GHS ${tbEarnings.toLocaleString("en-GH",{minimumFractionDigits:2})} returns` : "No bills yet", subColor: "var(--clr-green)" },
    { icon: "⏱",  label: "Funds Value",      value: fmtPlain(mfLatest),     sub: `+GHS ${mfInterest.toLocaleString("en-GH",{minimumFractionDigits:2})} interest`, subColor: "var(--clr-green)" },
    { icon: "💰", label: "Total Invested",   value: fmtPlain(totalInvested),sub: "across all investments", subColor: "var(--clr-dim)" },
  ];
  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ ...S.row, alignItems: "flex-start" }}>
          <div>
            <div style={S.label}>IC Securities</div>
            <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: -0.5, marginTop: 2 }}>Summary</div>
          </div>
          <div style={{ display: "flex", gap: "var(--gap-sm)", alignItems: "center", paddingTop: "clamp(4px,1.5vw,8px)" }}>
            <button className="theme-btn" onClick={() => setLightTheme(t => !t)}>{lightTheme ? "🌙" : "☀️"}</button>
            <button className="eye-btn" onClick={() => setHidden(h => !h)}>{hidden ? <EyeOffIcon /> : <EyeIcon />}</button>
          </div>
        </div>
      </div>
      <div style={S.hero}>
        <div style={S.label}>Total Portfolio Value</div>
        <div style={S.bigNum}>{hidden ? "••••••" : `GHS ${totalValue.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}</div>
        <div style={{ display: "flex", gap: "clamp(16px,4vw,28px)", marginTop: "clamp(10px,2.8vw,16px)" }}>
          <div><div style={S.label}>Total Earnings</div>
            <div style={{ color: hidden ? "var(--clr-dim)" : col(totalEarnings), fontWeight: 700, fontSize: "var(--fs-xl)" }}>
              {hidden ? "••••" : `${totalEarnings >= 0 ? "+" : ""}GHS ${Math.abs(totalEarnings).toLocaleString("en-GH",{minimumFractionDigits:2})}`}
            </div>
          </div>
          <div><div style={S.label}>Return</div>
            <div style={{ color: hidden ? "var(--clr-dim)" : col(totalEarnPct), fontWeight: 700, fontSize: "var(--fs-xl)" }}>
              {hidden ? "••••" : fmtPct(totalEarnPct)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)", marginTop: "clamp(8px,2vw,12px)" }}>Stocks + T-Bills + Mutual Funds</div>
      </div>
      <div className="section-label">Breakdown</div>
      <div className="summary-tiles">
        {tiles.map(tile => (
          <div key={tile.label} className="summary-tile">
            <div className="summary-tile-icon">{tile.icon}</div>
            <div className="summary-tile-label">{tile.label}</div>
            <div className="summary-tile-value">{hidden ? "••••••" : tile.value}</div>
            <div className="summary-tile-sub" style={{ color: tile.subColor }}>{hidden ? "••••" : tile.sub}</div>
          </div>
        ))}
      </div>
      <div className="section-label" style={{ marginTop: "var(--gap-md)" }}>Allocation</div>
      <div style={{ borderTop: "1px solid var(--clr-border)", borderBottom: "1px solid var(--clr-border)", background: "var(--clr-card)", padding: "0 var(--gutter,18px)" }}>
        {[["Stocks","📈",stocksValue,stocksInvested],["T-Bills","🏦",tbMaturity,tbInvested],["Mutual Funds","⏱",mfLatest,mfPrincipal]].map(([name,icon,val,inv]) => {
          const pct  = totalValue ? (val / totalValue) * 100 : 0;
          const earn = val - inv;
          return (
            <div key={name} className="stat-row">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                <span style={{ fontSize: "var(--fs-lg)" }}>{icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "var(--fs-md)" }}>{name}</div>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--clr-dim)" }}>{pct.toFixed(1)}% of portfolio</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: "var(--fs-md)" }}>{hidden ? "••••••" : `GHS ${val.toLocaleString("en-GH",{minimumFractionDigits:2})}`}</div>
                <div style={{ fontSize: "var(--fs-xs)", color: col(earn) }}>{hidden ? "••••" : `${earn>=0?"+":""}GHS ${Math.abs(earn).toLocaleString("en-GH",{minimumFractionDigits:2})}`}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const [pendingTrades,  setPendingTrades]  = useState(null); // trades waiting for merge/replace choice
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
  const [navTab,         setNavTab]         = useState("stocks"); // stocks | tbills | mutualfunds | summary
  // T-Bills
  const [tbills,         setTbills]         = useState([]);
  const [tbillSheet,     setTbillSheet]     = useState(false);
  const [editingTbill,   setEditingTbill]   = useState(null); // null = add, obj = edit
  const [tbForm,         setTbForm]         = useState({ label: "", principal: "", rate: "", maturityDate: "", duration: "91" });
  // Mutual Funds
  const [mfunds,         setMfunds]         = useState([]);
  const [mfSheet,        setMfSheet]        = useState(false);
  const [mfEntrySheet,   setMfEntrySheet]   = useState(null); // fund id being added entry for
  const [editingMF,      setEditingMF]      = useState(null);
  const [mfForm,         setMfForm]         = useState({ name: "", principal: "" });
  const [mfEntryForm,    setMfEntryForm]    = useState({ date: "", interest: "", maturityAmount: "" });
  const [showMFPct,      setShowMFPct]      = useState({});

  // ── Apply theme class to body ─────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle("light", lightTheme);
  }, [lightTheme]);
  const fileRef         = useRef();
  const importRef       = useRef();
  const backupImportRef = useRef();

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
        setPendingTrades(trades); // show merge/replace choice sheet
      }
    } catch (err) { setError("Error parsing PDF: " + err.message); }
    setLoading(false); setLoadMsg(""); e.target.value = "";
  }

  // ── Merge PDF trades into existing portfolio (add on top) ─────────────────
  function commitMerge() {
    const built = buildPortfolio(pendingTrades);
    setPortfolio(prev => {
      const next = { ...prev };
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
    setPendingTrades(null);
  }

  // ── Replace portfolio with PDF trades (fresh start) ───────────────────────
  async function commitReplace() {
    const built = buildPortfolio(pendingTrades);
    // Preserve current/prev prices for symbols that already exist
    setPortfolio(prev => {
      const next = {};
      for (const [sym, data] of Object.entries(built)) {
        next[sym] = {
          ...data,
          currentPrice: prev[sym]?.currentPrice ?? null,
          prevPrice:    prev[sym]?.prevPrice    ?? null,
        };
      }
      return next;
    });
    // Sync to DB: clear all then write new
    await dbClear();
    const built2 = buildPortfolio(pendingTrades);
    for (const [sym, data] of Object.entries(built2)) {
      await dbPut({ ...data, currentPrice: null, prevPrice: null });
    }
    setPendingTrades(null);
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

  // ── Import GSE Portfolio Backup (.txt base64) ─────────────────────────────
  async function handleBackupImport(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const built = parsePortfolioBackup(text);
      await dbClear();
      for (const r of Object.values(built)) await dbPut(r);
      setPortfolio(built);
    } catch (err) { setError("Backup import failed: " + err.message); }
    e.target.value = ""; setExportOpen(false);
  }
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

  // ── Load T-Bills from DB ──────────────────────────────────────────────────
  useEffect(() => {
    storeGetAll(STORE_TB).then(rows => setTbills(rows)).catch(() => {});
  }, []);

  // ── Load Mutual Funds from DB ─────────────────────────────────────────────
  useEffect(() => {
    storeGetAll(STORE_MF).then(rows => setMfunds(rows)).catch(() => {});
  }, []);

  // ── T-Bill CRUD ───────────────────────────────────────────────────────────
  function saveTbill() {
    const { label, principal, rate, maturityDate, duration } = tbForm;
    if (!principal || !rate) return;
    const p = parseFloat(principal), r = parseFloat(rate);
    if (isNaN(p) || isNaN(r)) return;
    // Formula: interest = principal × (rate / 100)
    // 91-day  → divide by 4  (quarter of a year)
    // 182-day → divide by 2  (half of a year)
    // 364-day → full year    (no division)
    const divisor = duration === "91" ? 4 : duration === "182" ? 2 : 1;
    const interest = (p * r / 100) / divisor;
    const maturityAmount = p + interest;
    const id = editingTbill?.id ?? `tb_${Date.now()}`;
    const record = { id, label: label || `${duration}-Day T-Bill`, principal: p, rate: r, duration, maturityDate, interest, maturityAmount };
    storePut(STORE_TB, record).catch(console.error);
    setTbills(prev => editingTbill
      ? prev.map(x => x.id === id ? record : x)
      : [...prev, record]);
    setTbForm({ label: "", principal: "", rate: "", maturityDate: "", duration: "91" });
    setTbillSheet(false); setEditingTbill(null);
  }
  function deleteTbill(id) {
    storeDelete(STORE_TB, id).catch(console.error);
    setTbills(prev => prev.filter(x => x.id !== id));
  }

  // ── Mutual Fund CRUD ──────────────────────────────────────────────────────
  function saveMF() {
    const { name, principal } = mfForm;
    if (!name) return;
    const p = parseFloat(principal) || 0;
    const id = editingMF?.id ?? `mf_${Date.now()}`;
    const record = editingMF
      ? { ...editingMF, name, principal: p }
      : { id, name, principal: p, entries: [] };
    storePut(STORE_MF, record).catch(console.error);
    setMfunds(prev => editingMF
      ? prev.map(x => x.id === id ? record : x)
      : [...prev, record]);
    setMfForm({ name: "", principal: "" });
    setMfSheet(false); setEditingMF(null);
  }
  function deleteMF(id) {
    storeDelete(STORE_MF, id).catch(console.error);
    setMfunds(prev => prev.filter(x => x.id !== id));
  }
  function saveMFEntry() {
    const { date, interest, maturityAmount } = mfEntryForm;
    if (!interest) return;
    const fund = mfunds.find(x => x.id === mfEntrySheet);
    if (!fund) return;
    const entry = { date: date || today(), interest: parseFloat(interest), maturityAmount: parseFloat(maturityAmount) || 0 };
    const updated = { ...fund, entries: [...(fund.entries || []), entry] };
    storePut(STORE_MF, updated).catch(console.error);
    setMfunds(prev => prev.map(x => x.id === mfEntrySheet ? updated : x));
    setMfEntryForm({ date: "", interest: "", maturityAmount: "" });
    setMfEntrySheet(null);
  }
  function deleteMFEntry(fundId, idx) {
    const fund = mfunds.find(x => x.id === fundId);
    if (!fund) return;
    const updated = { ...fund, entries: fund.entries.filter((_, i) => i !== idx) };
    storePut(STORE_MF, updated).catch(console.error);
    setMfunds(prev => prev.map(x => x.id === fundId ? updated : x));
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
  // TAB ROUTING — non-stock tabs
  // ═══════════════════════════════════════════════════════════════════════════
  if (navTab === "tbills") return (
    <>
      <TBillsScreen tbills={tbills} hidden={hidden} tbillSheet={tbillSheet} setTbillSheet={setTbillSheet}
        editingTbill={editingTbill} setEditingTbill={setEditingTbill}
        tbForm={tbForm} setTbForm={setTbForm} saveTbill={saveTbill} deleteTbill={deleteTbill}
        lightTheme={lightTheme} setLightTheme={setLightTheme} setHidden={setHidden} />
      <BottomNav tab={navTab} setTab={t => { setNavTab(t); }} />
    </>
  );

  if (navTab === "mutualfunds") return (
    <>
      <MutualFundsScreen mfunds={mfunds} hidden={hidden} mfSheet={mfSheet} setMfSheet={setMfSheet}
        editingMF={editingMF} setEditingMF={setEditingMF}
        mfForm={mfForm} setMfForm={setMfForm} saveMF={saveMF} deleteMF={deleteMF}
        mfEntrySheet={mfEntrySheet} setMfEntrySheet={setMfEntrySheet}
        mfEntryForm={mfEntryForm} setMfEntryForm={setMfEntryForm}
        saveMFEntry={saveMFEntry} deleteMFEntry={deleteMFEntry}
        showMFPct={showMFPct} setShowMFPct={setShowMFPct}
        lightTheme={lightTheme} setLightTheme={setLightTheme} setHidden={setHidden} />
      <BottomNav tab={navTab} setTab={t => { setNavTab(t); }} />
    </>
  );

  if (navTab === "summary") return (
    <>
      <SummaryScreen portfolio={portfolio} tbills={tbills} mfunds={mfunds}
        hidden={hidden} setHidden={setHidden} lightTheme={lightTheme} setLightTheme={setLightTheme} />
      <BottomNav tab={navTab} setTab={t => { setNavTab(t); }} />
    </>
  );

  if (navTab === "analyse") return (
    <>
      <StockAnalysisScreen lightTheme={lightTheme} setLightTheme={setLightTheme} hidden={hidden} setHidden={setHidden} />
      <BottomNav tab={navTab} setTab={t => { setNavTab(t); }} />
    </>
  );

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
      <>
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
      <BottomNav tab={navTab} setTab={t => { setNavTab(t); setScreen("home"); setShowMarket(false); }} />
    </>
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
          <input ref={fileRef}         type="file" accept=".pdf"  style={{ display: "none" }} onChange={handleFile} />
          <input ref={importRef}       type="file" accept=".json" style={{ display: "none" }} onChange={handleJSONImport} />
          <input ref={backupImportRef} type="file" accept=".txt"  style={{ display: "none" }} onChange={handleBackupImport} />

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

      {/* ── PDF import mode choice sheet ── */}
      {pendingTrades && (
        <div className="bottom-sheet">
          <div className="sheet-title">Statement Imported</div>
          <div style={{ fontSize: "var(--fs-base)", color: "var(--clr-dim)", marginBottom: "var(--gap-md)", lineHeight: 1.6 }}>
            Found <strong style={{ color: "var(--clr-text)" }}>{pendingTrades.length} transaction{pendingTrades.length !== 1 ? "s" : ""}</strong> in this statement.
            How would you like to apply them?
          </div>

          <button style={{ ...S.btn, marginTop: 0, marginBottom: "var(--gap-sm)", textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, padding: "clamp(12px,3vw,16px) clamp(14px,3.5vw,18px)" }}
            onClick={commitMerge}>
            <span style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>➕ Add to existing portfolio</span>
            <span style={{ fontSize: "var(--fs-sm)", fontWeight: 400, color: "rgba(255,255,255,.7)" }}>Merge these trades on top of what's already saved</span>
          </button>

          <button style={{ ...S.btn, marginTop: 0, marginBottom: "var(--gap-sm)", background: "rgba(245,34,45,.15)", color: "var(--clr-red)", border: "1px solid rgba(245,34,45,.3)", textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, padding: "clamp(12px,3vw,16px) clamp(14px,3.5vw,18px)" }}
            onClick={commitReplace}>
            <span style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>🔄 Replace portfolio</span>
            <span style={{ fontSize: "var(--fs-sm)", fontWeight: 400, color: "var(--clr-dim)" }}>Clear everything and use only this statement's data</span>
          </button>

          <button style={{ ...S.ghostBtn, marginTop: 0 }} onClick={() => setPendingTrades(null)}>Cancel</button>
        </div>
      )}

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

          <div style={S.label}>GSE Portfolio Backup</div>
          <div className="export-row">
            <button style={{ ...S.exportBtn, background: "rgba(0,200,83,.08)", color: "var(--clr-green)", border: "1px solid rgba(0,200,83,.25)" }}
              onClick={() => { exportPortfolioBackup(portfolio); setExportOpen(false); }}>
              📤 Export Backup (.txt)
            </button>
            <button style={{ ...S.exportBtn, background: "rgba(0,200,83,.08)", color: "var(--clr-green)", border: "1px solid rgba(0,200,83,.25)" }}
              onClick={() => backupImportRef.current.click()}>
              📥 Import Backup (.txt)
            </button>
          </div>
          <div className="sheet-hint">Base64-encoded format compatible with other GSE portfolio apps. Export to share with another app, or import a backup from one.</div>

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
      <BottomNav tab={navTab} setTab={setNavTab} />
    </div>
  );
}
