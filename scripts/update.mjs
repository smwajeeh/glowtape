// Glowtape market data updater.
// Pulls live prices from Alpaca's free market data API (IEX feed) and writes data.json
// in the format the website reads. Runs on GitHub Actions; needs ALPACA_KEY_ID and
// ALPACA_SECRET_KEY as repository secrets. Node 20+, no dependencies.
//
// Usage: node scripts/update.mjs <output path> [previous data.json]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, "..", "out", "data.json");
const PREV = process.argv[3];
const KEY = process.env.ALPACA_KEY_ID, SECRET = process.env.ALPACA_SECRET_KEY;
const FEED = process.env.ALPACA_FEED || "iex"; // "iex" is free; "sip" needs a paid plan
const BASE = process.env.ALPACA_DATA_URL || "https://data.alpaca.markets";
const U = JSON.parse(readFileSync(join(HERE, "universe.json"), "utf8"));
const TF = [5, 15, 60]; // minutes for the 5m, 15m and 1H moves

if (!KEY || !SECRET) {
  console.log("::warning::Alpaca keys are not set yet (ALPACA_KEY_ID / ALPACA_SECRET_KEY). Skipping update.");
  process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET, accept: "application/json" } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(1500 * (attempt + 1)); continue; }
    throw new Error(`Alpaca ${path} -> HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function snapshots(symbols) {
  const out = {};
  for (const part of chunk(symbols, 150)) Object.assign(out, await api("/v2/stocks/snapshots", { symbols: part.join(","), feed: FEED }));
  return out;
}
async function bars(symbols, timeframe, start) {
  const out = {};
  for (const part of chunk(symbols, 150)) {
    let page_token;
    do {
      const j = await api("/v2/stocks/bars", { symbols: part.join(","), timeframe, start, limit: 10000, adjustment: "split", feed: FEED, page_token });
      for (const [s, list] of Object.entries(j.bars || {})) (out[s] ||= []).push(...list);
      page_token = j.next_page_token;
    } while (page_token);
  }
  return out;
}

const pct = (now, ref) => (now > 0 && ref > 0 ? +((now / ref - 1) * 100).toFixed(3) : null);
const etDate = t => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function main() {
  const symbols = [...new Set([...Object.values(U.markets).flat().map(r => r[0]), ...U.etf.map(e => e[0])])];
  const now = Date.now();
  const snap = await snapshots(symbols);

  // Market "now" = latest trade time across all symbols (so after the close, moves show the end of the session).
  let tNow = 0;
  for (const s of Object.values(snap)) { const t = Date.parse(s?.latestTrade?.t || 0); if (t > tNow) tNow = t; }
  if (!tNow) throw new Error("No trades returned; check the API keys and feed.");

  if (PREV && existsSync(PREV)) {
    try { const prev = JSON.parse(readFileSync(PREV, "utf8")); if (prev.asOf && Date.parse(prev.asOf) >= tNow && prev.source === "alpaca") { console.log("No new trades since", prev.asOf, "- nothing to update."); writeFileSync(OUT, readFileSync(PREV)); return; } } catch {}
  }

  const intraday = await bars(symbols, "5Min", new Date(tNow - 130 * 60000).toISOString());
  const daily = await bars(symbols, "1Day", new Date(now - 45 * 86400000).toISOString());
  const today = etDate(tNow);

  const quote = {};
  for (const sym of symbols) {
    const s = snap[sym] || {};
    const price = s.latestTrade?.p || s.minuteBar?.c || s.dailyBar?.c || null;
    // previous session close: if today's daily bar exists, prevDailyBar is yesterday; otherwise dailyBar is the last session
    const dayIsToday = s.dailyBar?.t && etDate(s.dailyBar.t) === today;
    const prevClose = dayIsToday ? s.prevDailyBar?.c : s.dailyBar?.c ?? s.prevDailyBar?.c;
    const ib = intraday[sym] || [];
    const intra = TF.map(m => {
      const cut = tNow - m * 60000; let ref = null;
      for (const b of ib) { if (Date.parse(b.t) + 5 * 60000 <= cut) ref = b.c; else break; }
      if (ref == null && ib.length && Date.parse(ib[0].t) <= cut) ref = ib[0].o;
      // a 5-minute window inside today's session: fall back to the previous close only for the 1H move at the open
      return pct(price, ref);
    });
    const closes = (daily[sym] || []).filter(b => etDate(b.t) !== today).map(b => b.c);
    const w1 = closes.length >= 5 ? pct(price, closes[closes.length - 5]) : null;
    const mo1 = closes.length >= 21 ? pct(price, closes[closes.length - 21]) : null;
    quote[sym] = { price, chg: [...intra, pct(price, prevClose), w1, mo1] };
  }

  const out = { asOf: new Date(tNow).toISOString(), generated: new Date(now).toISOString(), source: "alpaca", feed: FEED };
  for (const [m, rows] of Object.entries(U.markets)) {
    // scale caps by price, then rescale weights so each market keeps its original total weight
    const base = rows.map(([sym, name, p0, cap0, w0, sec]) => {
      const q = quote[sym] || {}; const price = q.price || p0; const k = price / p0;
      return { sym, name, price, chg: q.chg || [null, null, null, null, null, null], cap: cap0 * k, w: w0 * k, w0, sec };
    });
    const tot0 = rows.reduce((a, r) => a + r[4], 0), tot = base.reduce((a, r) => a + r.w, 0) || 1;
    base.forEach(r => (r.w = (r.w * tot0) / tot));
    const by = Object.fromEntries(base.map(r => [r.sym, r])), drop = new Set();
    for (const [a, [b]] of Object.entries(U.pairs)) if (by[a] && by[b]) drop.add(b);
    out[m] = base.filter(r => !drop.has(r.sym)).map(r => {
      const pair = U.pairs[r.sym];
      if (pair && by[pair[0]]) {
        const o = by[pair[0]], W = r.w + o.w;
        const chg = r.chg.map((x, i) => (x == null || o.chg[i] == null ? x ?? o.chg[i] : +((x * r.w + o.chg[i] * o.w) / W).toFixed(3)));
        return [r.sym, pair[1], r.price, chg, +Math.max(r.cap, o.cap).toFixed(2), +W.toFixed(3), r.sec, o.sym];
      }
      return [r.sym, r.name, r.price, r.chg, +r.cap.toFixed(2), +r.w.toFixed(3), r.sec];
    });
  }
  out.etf = U.etf.map(([sym, p0]) => [sym, quote[sym]?.price || p0, quote[sym]?.chg || [null, null, null, null, null, null]]);

  const missing = symbols.filter(s => !quote[s]?.price);
  const nulls = symbols.filter(s => quote[s]?.chg?.[3] == null);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT}: ${symbols.length} symbols, as of ${out.asOf}. No price: ${missing.length} ${missing.slice(0, 10).join(" ")}. No 1D move: ${nulls.length}.`);
}

main().catch(e => { console.error("::error::" + e.message); process.exit(1); });
