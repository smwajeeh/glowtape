// Downloads price history from Alpaca for the Wyckoff Lab.
// Usage: node scripts/history.mjs <outDir> SYM1,SYM2,...
// Writes <outDir>/<SYM>.json = { sym, feed, bars: { "1Day": [[t,o,h,l,c,v]...], "30Min": [...], "15Min": [...], "5Min": [...] } }
// t = unix seconds (bar start). Intraday bars are regular session only (9:30–16:00 New York).
import { mkdirSync, writeFileSync } from "node:fs";
const [outDir = "out/history", list = "QQQ,GOOG,ADBE"] = process.argv.slice(2);
const KEY = process.env.ALPACA_KEY_ID, SECRET = process.env.ALPACA_SECRET_KEY;
if (!KEY || !SECRET) { console.error("::error::Missing Alpaca keys"); process.exit(1); }
const BASE = "https://data.alpaca.markets";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let a = 0; ; a++) {
    const r = await fetch(url, { headers: { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && a < 5) { await sleep(2000 * (a + 1)); continue; }
    throw new Error(`${path} ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}
const nyParts = t => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
  const g = k => p.find(x => x.type === k).value;
  return { h: +g("hour") % 24, m: +g("minute") };
};
async function bars(sym, timeframe, start, feed) {
  const out = []; let page_token;
  const end = new Date(Date.now() - 20 * 60000).toISOString();
  do {
    const j = await get(`/v2/stocks/${encodeURIComponent(sym)}/bars`, { timeframe, start, end, limit: 10000, adjustment: "all", feed, page_token });
    for (const b of j.bars || []) {
      const t = Date.parse(b.t);
      if (timeframe !== "1Day") { const { h, m } = nyParts(t); const mins = h * 60 + m; if (mins < 570 || mins >= 960) continue; }
      out.push([Math.round(t / 1000), b.o, b.h, b.l, b.c, b.v]);
    }
    page_token = j.next_page_token;
  } while (page_token);
  return out;
}
const PLAN = { "1Day": "2016-01-01", "30Min": "2020-06-01", "15Min": "2026-04-01", "5Min": "2026-07-01" };
mkdirSync(outDir, { recursive: true });
for (const sym of list.split(",").map(s => s.trim()).filter(Boolean)) {
  const res = { sym, bars: {} };
  for (const [tf, start] of Object.entries(PLAN)) {
    let feed = "sip", b;
    try { b = await bars(sym, tf, start, "sip"); } catch (e) { console.log(`sip failed for ${sym} ${tf}: ${e.message}; using iex`); feed = "iex"; b = await bars(sym, tf, start, "iex"); }
    res.bars[tf] = b; res.feed = res.feed && res.feed !== feed ? "mixed" : feed;
    console.log(`${sym} ${tf}: ${b.length} bars (${feed})`);
  }
  writeFileSync(`${outDir}/${sym.replace(/[^A-Z0-9.]/gi, "_")}.json`, JSON.stringify(res));
}
