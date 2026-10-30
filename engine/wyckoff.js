// Glowtape Wyckoff Engine (rulebook v2.4). Runs in Node and in the browser, no dependencies.
// Bars are arrays: [t, open, high, low, close, volume], t = unix seconds (bar start).
//
// Accumulation is detected directly. Distribution is detected by mirroring prices (p -> -p),
// running the same accumulation logic, and mirroring the results back.

export const DEFAULTS = {
  pivot: 2,            // swing point = high/low with this many candles on each side (structure breaks)
  htfPivot: 2,         // swing size on the range timeframe
  retrace: 0.5,        // range is valid after price retraces this much of the range
  limit: 0.35,         // max excursion outside the range (fraction of range height)
  stZone: 0.1,         // ST must reach within this fraction of the range from the SC low (or beyond it)
  minTrend: 0.75,      // move into the SC must be at least this many range heights
  lookback: 120,       // range-timeframe candles searched for the start of the trend
  minRangeAtr: 1.5,    // range height must be at least this many ATRs (range timeframe)
  tp1Share: 0.7,       // two-step target: share closed at TP1
  twoStep: true,       // use the trend start as TP2 when it lies beyond the bounce extreme
  riskPct: 0.01,       // risk per trade
  capital: 100000,
  tick: 0.01,
  allowHL: true,       // Schematic #2 (higher low instead of a spring)
  hlRetry: true,       // an HL trade stopped out by a move into the Spring zone keeps the range alive for the Spring
  stReact: 0.25,       // ST is confirmed once price moves this far (fraction of range) away from it
  stStructure: true,   // ...or once a range-timeframe candle closes beyond the last swing into the ST
};

// ---------- time helpers (New York session) ----------
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
const nyCache = new Map();
export function ny(t) {
  let v = nyCache.get(t); if (v) return v;
  const p = fmt.formatToParts(new Date(t * 1000)), g = k => p.find(x => x.type === k).value;
  v = { date: `${g("year")}-${g("month")}-${g("day")}`, mins: (+g("hour") % 24) * 60 + +g("minute"), wd: g("weekday") };
  if (nyCache.size > 400000) nyCache.clear();
  nyCache.set(t, v); return v;
}

// Group bars by a key function; keeps order. Returns aggregated OHLCV bars.
export function aggregate(bars, keyFn) {
  const out = []; let key = null, cur = null;
  for (const b of bars) {
    const k = keyFn(b);
    if (k !== key) { if (cur) out.push(cur); key = k; cur = [b[0], b[1], b[2], b[3], b[4], b[5] || 0]; }
    else { cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.min(cur[3], b[3]); cur[4] = b[4]; cur[5] += b[5] || 0; }
  }
  if (cur) out.push(cur);
  return out;
}
const isoWeek = d => { const dt = new Date(d + "T12:00:00Z"); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); };

// Build every timeframe the engine uses from the raw history file.
// raw = { "1Day": [...], "30Min": [...], "15Min": [...], "5Min": [...] }
export function buildFrames(raw) {
  const d = raw["1Day"] || [], m30 = raw["30Min"] || [];
  const f = {};
  f["5m"] = raw["5Min"] || [];
  f["15m"] = raw["15Min"] || [];
  f["1H"] = aggregate(m30, b => { const n = ny(b[0]); return n.date + "|" + Math.floor((n.mins - 570) / 60); });
  f["4H"] = aggregate(m30, b => { const n = ny(b[0]); return n.date + "|" + (n.mins < 810 ? 0 : 1); }); // 9:30–13:30, 13:30–16:00
  f["D"] = d;
  f["W"] = aggregate(d, b => isoWeek(ny(b[0] + 43200).date));
  f["M"] = aggregate(d, b => ny(b[0] + 43200).date.slice(0, 7));
  f["3D"] = aggregate(d.map((b, i) => [...b, i]), b => Math.floor(b[6] / 3)).map(b => b.slice(0, 6));
  return f;
}

// Timeframe pairings: range timeframe -> entry timeframe
export const MODELS = [
  { id: "1H-5m", htf: "1H", ltf: "5m", label: "1H range → 5m entry" },
  { id: "4H-15m", htf: "4H", ltf: "15m", label: "4H range → 15m entry" },
  { id: "4H-1H", htf: "4H", ltf: "1H", label: "4H range → 1H entry" },
  { id: "D-1H", htf: "D", ltf: "1H", label: "Daily range → 1H entry" },
  { id: "W-4H", htf: "W", ltf: "4H", label: "Weekly range → 4H entry" },
  { id: "3D-4H", htf: "3D", ltf: "4H", label: "3-day range → 4H entry" },
  { id: "M-4H", htf: "M", ltf: "4H", label: "Monthly range → 4H entry" },
];
const SPAN = { "5m": 300, "15m": 900, "1H": 3600, "4H": 14400, D: 86400, "3D": 3 * 86400, W: 7 * 86400, M: 31 * 86400 };

// ---------- primitives ----------
const mirror = bars => bars.map(b => [b[0], -b[1], -b[3], -b[2], -b[4], b[5]]);
function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(0); let s = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], pc = i ? bars[i - 1][4] : b[4];
    const tr = Math.max(b[2] - b[3], Math.abs(b[2] - pc), Math.abs(b[3] - pc));
    s = i < n ? s + tr : s + (tr - s / n) * 1; // running sum approximation
    out[i] = i < n ? s / (i + 1) : (out[i - 1] * (n - 1) + tr) / n;
  }
  return out;
}
const isPivotLow = (bars, i, k) => { if (i < k || i + k >= bars.length) return false; for (let j = i - k; j <= i + k; j++) if (j !== i && bars[j][3] < bars[i][3]) return false; return true; };
const isPivotHigh = (bars, i, k) => { if (i < k || i + k >= bars.length) return false; for (let j = i - k; j <= i + k; j++) if (j !== i && bars[j][2] > bars[i][2]) return false; return true; };

// ---------- range finder (accumulation orientation) ----------
// Returns candidate ranges: { sc, ar, scI, arI, startHigh, startI, validI, R }
function findRanges(H, o) {
  const k = o.htfPivot, A = atr(H), out = [];
  for (let i = k; i < H.length - 1; i++) {
    if (!isPivotLow(H, i, k)) continue;
    const sc = H[i][3];
    // start of the trend: highest high since price was last below the SC (within the lookback)
    let sI = -1, sH = -Infinity;
    for (let j = i - 1; j >= Math.max(0, i - o.lookback); j--) {
      if (H[j][3] < sc) break;
      if (H[j][2] > sH) { sH = H[j][2]; sI = j; }
    }
    if (sI < 0) continue;
    // every bounce high that is followed by a >= 50% retrace (before a higher high) is a range
    let M = -Infinity, mI = -1;
    // a climax candle that closes in its upper half already contains the start of the bounce
    if (H[i][4] >= (H[i][2] + H[i][3]) / 2) { M = H[i][2]; mI = i; }
    for (let j = i + 1; j < H.length; j++) {
      if (H[j][3] < sc) break; // new low below SC: this SC is done
      if (H[j][2] > M) { M = H[j][2]; mI = j; continue; }
      const R = M - sc;
      if (H[j][3] <= sc + (1 - o.retrace) * R && (mI > i || (mI === i && j > i))) {
        if (R >= o.minRangeAtr * A[i] && sH - sc >= o.minTrend * R)
          out.push({ scI: i, sc, arI: mI, ar: M, startI: sI, startHigh: sH, validI: j, R });
        // keep scanning for a bigger bounce (nested ranges); a higher high starts a new candidate
        M = M; // unchanged until a higher high appears
        // skip ahead until a higher high to avoid duplicate ranges with the same bounce high
        let jj = j + 1; while (jj < H.length && H[jj][2] <= M && H[jj][3] >= sc) jj++;
        j = jj - 1;
      }
    }
  }
  return out;
}

// ---------- the setup state machine, walked on the entry timeframe ----------
// H: range-timeframe bars, L: entry-timeframe bars (both in accumulation orientation)
function runRange(rg, H, L, o, entryMode, htfSpan) {
  const { sc, ar, R } = rg, mid = sc + R / 2, lim = sc - o.limit * R, cap = ar + o.limit * R;
  const ev = { range: rg, mid, limit: lim, cap, taps: [], status: "watching", entryMode };
  // 1) find the ST on the range timeframe after the 50% retrace
  let st = Infinity, stI = -1, stConfI = -1, react = -Infinity;
  for (let j = rg.validI; j < H.length; j++) {
    const b = H[j];
    if (b[3] < lim) { ev.status = "dead"; ev.why = "broke beyond the 35% limit before the ST"; ev.endT = b[0]; return ev; }
    if (b[2] > cap) { ev.status = "dead"; ev.why = "left the range the other way before the ST"; ev.endT = b[0]; return ev; }
    if (b[3] <= sc + o.stZone * R && b[3] < st) { st = b[3]; stI = j; react = b[4]; } // the ST candle's own close counts as reaction
    else if (stI >= 0 && b[2] > react) react = b[2];
    if (stI >= 0 && react - st >= o.stReact * R) { stConfI = j; break; }
    // or: a candle closes above the last swing high formed on the way into the ST
    if (o.stStructure && stI >= 0 && j > stI) {
      let lastLH = null;
      for (let m = stI - 1; m >= Math.max(rg.validI - 2, 0); m--) if (isPivotHigh(H, m, o.htfPivot)) { lastLH = H[m][2]; break; }
      if (lastLH != null && b[4] > lastLH) { stConfI = j; break; }
    }
  }
  if (stConfI < 0) { ev.status = stI >= 0 ? "st-forming" : "waiting-st"; if (stI >= 0) ev.taps.push({ n: 2, name: "ST", t: H[stI][0], p: st }); return ev; }
  ev.taps.push({ n: 2, name: "ST", t: H[stI][0], p: st });
  ev.stConfT = H[stConfI][0];

  // 2) walk the entry timeframe from the candle after ST confirmation
  const startT = H[stConfI][0] + htfSpan;
  const n0 = L.findIndex(b => b[0] >= startT);
  if (n0 < 0) { ev.status = L.length && L[L.length - 1][0] < startT ? "armed-no-ltf" : "no-entry-data"; return ev; }
  if (L.length && L[0][0] > startT) { ev.status = "no-entry-data"; ev.why = "entry timeframe history starts later"; return ev; }
  ev.trades = [];
  let from = n0, springOnly = false;
  for (let guard = 0; guard < 3; guard++) {
    const w = walk(rg, L, o, entryMode, from, n0, springOnly, { sc, ar, R, mid, lim, cap, st });
    if (w.tap) ev.taps.push(w.tap);
    if (w.firstBreak) ev.firstBreak = w.firstBreak;
    ev.status = w.status; ev.why = w.why; ev.endT = w.endT;
    if (!w.trade) break;
    ev.trades.push(w.trade);
    ev.status = w.trade.open ? "in-trade" : "closed"; ev.endT = w.trade.exitT || null;
    // A Schematic #2 (higher low) trade stopped out by a move into the Spring zone does not break the range:
    // keep watching for the Spring, still inside the 35% limit.
    const stopped = !w.trade.open && w.trade.fills[w.trade.fills.length - 1].why === "stop";
    if (o.hlRetry && w.trade.type === "HL" && stopped) { from = w.trade.exitN; springOnly = true; continue; }
    break;
  }
  ev.trade = ev.trades.length ? ev.trades[ev.trades.length - 1] : null;
  return ev;
}

// One pass over the entry timeframe: find tap 3, then the structure-break entry.
function walk(rg, L, o, entryMode, from, n0, springOnly, lv) {
  const { sc, ar, R, mid, lim, cap, st } = lv, k = o.pivot;
  let peak = -Infinity, peakN = -1, tap3 = null, tap3Type = null, tapN = -1;
  let firstBreak = null, pbHigh = -Infinity, pbLow = Infinity, pbReady = false, pbN = -1;
  for (let n = from; n < L.length; n++) {
    const b = L[n];
    if (b[3] < lim) return { status: "dead", why: "broke beyond the 35% limit", endT: b[0] };
    if (!tap3 && b[2] > cap) return { status: "dead", why: "left the range the other way before tap 3", endT: b[0] };
    if (!tap3) {
      if (b[2] > peak) { peak = b[2]; peakN = n; }
      // tap 3: Spring = at/beyond the more extreme of SC and ST; Higher Low = above the ST, in the lower half
      if (b[3] <= Math.min(sc, st)) { tap3Type = "Spring"; tap3 = b[3]; tapN = n; }
      else if (!springOnly && o.allowHL && b[3] > st && b[3] <= mid && n > peakN && peak - b[3] >= 0.25 * R) { tap3Type = "HL"; tap3 = b[3]; tapN = n; }
      if (!tap3) continue;
    } else if (b[3] < tap3) {
      tap3 = b[3]; tapN = n;
      if (tap3Type === "HL" && b[3] <= Math.min(sc, st)) tap3Type = "Spring";
      if (tap3Type === "HL" && b[3] <= st) { tap3 = null; tap3Type = null; tapN = -1; continue; } // HL lost, not yet a Spring
      firstBreak = null; pbHigh = -Infinity; pbLow = Infinity; pbReady = false; pbN = -1;
    }
    // structure break: a candle body closes above the last swing high that formed BEFORE the tap-3 extreme
    // (the swing the final push into tap 3 started from). Swings formed after the extreme don't count.
    const refBefore = entryMode === "pullback" && firstBreak && pbReady ? pbN : tapN;
    let swing = null;
    for (let m = Math.min(refBefore - 1, n - k); m >= Math.max(k, n0 - 200); m--) if (isPivotHigh(L, m, k)) { swing = L[m][2]; break; }
    if (swing == null) continue;
    const brk = b[4] > swing;
    if (entryMode === "pullback" && firstBreak) {
      if (b[2] > pbHigh) pbHigh = b[2];
      const fib50 = pbHigh - 0.5 * (pbHigh - tap3);
      if (b[3] <= fib50 && (!pbReady || b[3] < pbLow)) { pbReady = true; pbLow = b[3]; pbN = n; continue; }
      if (!pbReady || !brk || n <= pbN) continue;
    } else if (!brk) continue;
    if (entryMode === "pullback" && !firstBreak) { firstBreak = { t: b[0], p: b[4] }; pbHigh = b[2]; continue; }
    // ENTRY
    const tap = { n: 3, name: tap3Type, t: L[tapN][0], p: tap3 };
    const stopBase = tap3Type === "Spring" ? tap3 : st;
    const entry = b[4], sl = stopBase - o.tick, tp1 = ar;
    const tp2 = o.twoStep && rg.startHigh > ar ? rg.startHigh : null;
    if (entry >= tp1) return { status: "skipped", why: "entry already past the target", endT: b[0], tap, firstBreak };
    const trade = simulate(L, n, entry, sl, tp1, tp2, o);
    trade.type = tap3Type; trade.entryT = b[0]; trade.tap3 = tap3; trade.tap3T = L[tapN][0];
    if (firstBreak) trade.firstBreak = firstBreak;
    return { status: "entered", trade, tap, firstBreak };
  }
  if (tap3) return { status: "tap3-waiting-break", tap: { n: 3, name: tap3Type, t: L[tapN][0], p: tap3, pending: true } };
  return { status: "watching" };
}

// Walk forward from the entry candle; conservative when stop and target sit in the same candle.
function simulate(L, n, entry, sl, tp1, tp2, o) {
  const risk = entry - sl, qty = Math.max(1, Math.floor((o.capital * o.riskPct) / risk));
  const tr = { entry, sl, tp1, tp2, qty, risk, fills: [], open: true };
  let stop = sl, left = 1, hit1 = false;
  for (let m = n + 1; m < L.length; m++) {
    const b = L[m];
    if (b[3] <= stop) { const px = Math.min(stop, b[1]); tr.fills.push({ t: b[0], p: px, share: left, why: hit1 ? "breakeven" : "stop" }); left = 0; tr.exitT = b[0]; tr.exitN = m; break; }
    if (!hit1 && b[2] >= tp1) {
      const px = Math.max(tp1, b[1]);
      if (tp2 == null) { tr.fills.push({ t: b[0], p: px, share: 1, why: "target" }); left = 0; tr.exitT = b[0]; break; }
      tr.fills.push({ t: b[0], p: px, share: o.tp1Share, why: "TP1" }); left = 1 - o.tp1Share; hit1 = true; stop = entry;
      if (b[2] >= tp2) { tr.fills.push({ t: b[0], p: Math.max(tp2, b[1]), share: left, why: "TP2" }); left = 0; tr.exitT = b[0]; break; }
      continue;
    }
    if (hit1 && b[2] >= tp2) { tr.fills.push({ t: b[0], p: Math.max(tp2, b[1]), share: left, why: "TP2" }); left = 0; tr.exitT = b[0]; break; }
  }
  tr.open = left > 0;
  const last = L[L.length - 1][4];
  const realized = tr.fills.reduce((a, f) => a + (f.p - entry) * f.share, 0);
  const unreal = tr.open ? (last - entry) * left : 0;
  tr.r = +(((realized + unreal) / risk)).toFixed(2);
  tr.pnl = +((realized + unreal) * qty).toFixed(2);
  return tr;
}

// ---------- public: scan one symbol, one model, both directions ----------
export function scan(frames, model, opts = {}, entryMode = "break") {
  const o = { ...DEFAULTS, ...opts };
  const H0 = frames[model.htf], L0 = frames[model.ltf];
  if (!H0?.length || !L0?.length) return [];
  const res = [];
  for (const dir of ["long", "short"]) {
    const H = dir === "long" ? H0 : mirror(H0), L = dir === "long" ? L0 : mirror(L0);
    const ranges = findRanges(H, o);
    for (const rg of ranges) {
      const ev = runRange(rg, H, L, o, entryMode, SPAN[model.htf]);
      ev.dir = dir; ev.model = model.id;
      res.push(dir === "long" ? ev : unmirror(ev));
    }
  }
  // drop exact duplicates (same direction, same entry candle, same target)
  const seen = new Set();
  return res.filter(e => { if (!e.trades?.length) return true; const key = e.dir + e.trades.map(t => t.entryT).join() + e.trade.tp1.toFixed(2); if (seen.has(key)) return false; seen.add(key); return true; })
    .map(e => describe(e, H0));
}
function unmirror(e) {
  const neg = x => (x == null ? x : -x);
  const r = e.range;
  e.range = { ...r, sc: -r.sc, ar: -r.ar, startHigh: -r.startHigh };
  e.mid = -e.mid; e.limit = -e.limit; e.cap = -e.cap;
  e.taps = e.taps.map(t => ({ ...t, p: -t.p, name: t.name === "Spring" ? "UTAD" : t.name === "HL" ? "LH" : t.name }));
  if (e.firstBreak) e.firstBreak = { ...e.firstBreak, p: -e.firstBreak.p };
  if (e.trades) {
    e.trades = e.trades.map(t => ({ ...t, entry: -t.entry, sl: -t.sl, tp1: -t.tp1, tp2: neg(t.tp2), tap3: -t.tap3,
      firstBreak: t.firstBreak ? { ...t.firstBreak, p: -t.firstBreak.p } : undefined,
      fills: t.fills.map(f => ({ ...f, p: -f.p })), type: t.type === "Spring" ? "UTAD" : t.type === "HL" ? "LH" : t.type }));
    e.trade = e.trades.length ? e.trades[e.trades.length - 1] : null;
  }
  return e;
}
function describe(e, H) {
  const r = e.range;
  e.levels = { tap1: r.sc, bounce: r.ar, trendStart: r.startHigh, mid: e.mid, limit: e.limit };
  e.t = { tap1: H[r.scI][0], bounce: H[r.arI][0], trendStart: H[r.startI][0], valid: H[r.validI][0] };
  e.id = `${e.model}:${e.dir}:${e.t.tap1}:${e.t.bounce}:${e.entryMode}`;
  return e;
}

// Scan all models for one symbol.
export function scanAll(raw, opts = {}) {
  const frames = buildFrames(raw);
  const out = [];
  for (const m of MODELS) for (const mode of ["break", "pullback"]) out.push(...scan(frames, m, opts, mode));
  return { frames, setups: out };
}
export const _internals = { findRanges, runRange, mirror, atr, isPivotLow };
