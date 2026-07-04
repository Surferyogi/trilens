import { useEffect, useMemo, useState } from "react";

/*
  TriLens — Recession & Market-Peak Monitor (PWA)
  v13:40: (1) Overall Read shows its data as-of time — the OLDEST fetched_at across det/AI/Japan blocks
  (honest: server cache means render time ≠ data time). (2) Japan watch moved to its own JAPAN WATCH line
  in the banner. (3) One canonical jpMessage() now feeds the banner, Lens Summary AND the Japan section
  read line — the three previously-drifting phrasings are permanently aligned, with a beginner insight
  in the amber state explaining what "pressure building" means. Banner color-override logic unchanged.
  v07:43: Lens-3 summary row now reports the MOVING-AVERAGE DIRECTION (computed from backend sl50/sl150
  slopes; both rising = UP, both falling = DOWN, else mixed) with raw slopes shown — dot still follows
  t3.state so it can never contradict the banner. Japan moved out of the lens list into its own
  "ADDITIONAL WATCH" sub-section after the three lenses (override/amplifier, per disclosed methodology).
  v07:38: LENS SUMMARY panel below the Overall Read — one state-dotted beginner line per lens (1/2/3/Japan)
  with live computed counts. Reuses the banner's own aggregates (l1Band/frothBand/t3/japanWorst) so the
  summary can never diverge from the banner; jpS hoisted out of the banner IIFE (computed once).
  v22:28: (1) CoT early-warning wired into Overall Read — amber-grade only (4w short-covering >= +60k off
  a short base; calibrated on 1986→ weekly distribution, rarest ~1% of weeks; empirically LED the yen gauge
  before the Aug-2007 and Aug-2024 unwinds — early-but-noisier = amber lift, confirmed gauges stay the red
  triggers). (2) Unified Lens-1 visual language everywhere: dots + mono 19px state-colored readings across
  Lens 2, Japan Lens, Lens 3, carry chart. (3) Plain-English beginner takeaway per indicator, state-dependent.
  Backend: Supabase Edge Function `trilens-data` on project pvqwpzbjremcyobnsldd
  Tiers:  DET  = deterministic public APIs (FRED keyless CSV, Yahoo Finance, multpl)
          AI   = Claude + live web search, ONLY for series with no free API
          both cached server-side (det 6h / ai 24h) with labelled age
  DATA HONESTY: no reading is hardcoded in this file. Missing/unverifiable => "Data unavailable".
  Thresholds are disclosed methodology, printed on every card.
*/

const APP_VERSION = "v2026:07:04-13:40";
const API = "https://pvqwpzbjremcyobnsldd.supabase.co/functions/v1/trilens-data";

const C = {
  bg: "#0B0E14", panel: "#141926", panelSoft: "#10151F", line: "#232B3D",
  text: "#E8ECF4", mute: "#8B94A7", faint: "#5A6478",
  green: "#3DD68C", amber: "#F2B23E", red: "#F0564B", gold: "#C9A24B", blue: "#7FA9E8",
};
const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
const dotColor = (s) => (s === "green" ? C.green : s === "amber" ? C.amber : s === "red" ? C.red : C.faint);
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

/* stale hint: AI self-reported flag, or an as-of string mentioning a past year */
function looksStale(meta) {
  if (!meta) return false;
  if (meta.stale === true) return true;
  const yr = new Date().getFullYear();
  const m = String(meta.d || "").match(/(20\d\d)/g);
  if (m && Math.max(...m.map(Number)) < yr) return true;
  return false;
}

/* ---------- lens 1 ---------- */
function lens1Rows(det, ai) {
  const rows = [
    { name: "Yield Curve", sub: "10yr − 3mo Treasury spread", tier: "DET",
      note: "Inverted before every U.S. recession since the 1960s, ~12–18mo lead.",
      rule: "Green ≥ +0.25 · Amber 0 to +0.25 · Red < 0",
      tips: { green: "The bond market sees no recession ahead.", amber: "The bond market’s warning light is flickering.", red: "The bond market is flashing a recession warning." },
      v: num(det?.yc?.v), meta: det?.yc,
      fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`,
      st: (v) => (v >= 0.25 ? "green" : v >= 0 ? "amber" : "red") },
    { name: "Sahm Rule", sub: "jobs momentum", tier: "DET",
      note: "Fires when 3-mo avg unemployment rises 0.5pt off its 12-mo low. Caught every recession start since 1970.",
      rule: "Green < 0.35 · Amber 0.35–0.49 · Red ≥ 0.50 (official trigger)",
      tips: { green: "The job market is healthy — no recession signal.", amber: "Jobs are softening — watch closely.", red: "This jobs signal says a recession has likely already begun." },
      v: num(det?.sahm?.v), meta: det?.sahm,
      fmt: (v) => v.toFixed(2),
      st: (v) => (v >= 0.5 ? "red" : v >= 0.35 ? "amber" : "green") },
    { name: "High-Yield Credit Spreads", sub: "HY OAS", tier: "DET",
      note: "Cleanest market stress gauge; blows out into downturns. Very tight = complacency.",
      rule: "Green < 4.0% · Amber 4.0–5.5% · Red > 5.5%",
      tips: { green: "Lenders are calm — no stress in credit markets.", amber: "Lenders are getting nervous — credit stress rising.", red: "Credit markets are in trouble — a serious warning." },
      v: num(det?.hy?.v), meta: det?.hy,
      fmt: (v) => `${v.toFixed(2)}%`,
      st: (v) => (v > 5.5 ? "red" : v >= 4 ? "amber" : "green") },
    { name: "ISM Manufacturing PMI", sub: "factory activity", tier: "AI",
      note: "Below 50 = contraction.",
      rule: "Green ≥ 50 · Amber 47–49.9 · Red < 47",
      tips: { green: "Factories are growing — the economy has momentum.", amber: "Factories are slowing down.", red: "Factories are shrinking — the economy is losing steam." },
      v: num(ai?.ism?.v), meta: ai?.ism,
      fmt: (v) => v.toFixed(1),
      st: (v) => (v >= 50 ? "green" : v >= 47 ? "amber" : "red") },
    { name: "Conference Board LEI", sub: "6-month % change", tier: "AI",
      note: "Built to lead the cycle; deep sustained declines precede recessions.",
      rule: "Green > 0 · Amber −3% to 0 · Red < −3%",
      tips: { green: "The forward-looking gauges point to growth.", amber: "The forward-looking gauges are soft, but not recessionary.", red: "The forward-looking gauges point to a downturn." },
      v: num(ai?.lei?.v), meta: ai?.lei,
      fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}% (6m)${num(ai?.lei?.lvl) !== null ? ` · lvl ${ai.lei.lvl}` : ""}`,
      st: (v) => (v > 0 ? "green" : v >= -3 ? "amber" : "red") },
    { name: "Labor Market", sub: "unemployment vs 12-mo low", tier: "DET",
      note: "Rising unemployment off the cycle low is the classic pre-recession tell.",
      rule: "Green < +0.2pt off low · Amber +0.2–0.49 · Red ≥ +0.5",
      tips: { green: "Unemployment is near its lows — all clear.", amber: "Unemployment is creeping up — early caution.", red: "Unemployment is rising fast — a classic recession sign." },
      v: num(det?.labor?.off_low), meta: det?.labor,
      fmt: (v) => `+${v.toFixed(1)}pt off low`,
      extra: det?.labor ? `UR ${det.labor.ur}%${num(det.labor.pay_k) !== null ? ` · payrolls ${det.labor.pay_k > 0 ? "+" : ""}${det.labor.pay_k}k` : ""}` : null,
      st: (v) => (v >= 0.5 ? "red" : v >= 0.2 ? "amber" : "green") },
    { name: "Valuation", sub: "Shiller CAPE", tier: "DET",
      note: "Not a timing tool — predicts weak long-run returns, not the turn date.",
      rule: "Green < 25 · Amber 25–32 · Red > 32",
      tips: { green: "Stocks are reasonably priced by history.", amber: "Stocks are pricey — long-run returns likely lower.", red: "Stocks are very expensive by history — but this alone never times a crash." },
      v: num(det?.cape?.v), meta: det?.cape,
      fmt: (v) => `~${v.toFixed(1)}`,
      st: (v) => (v > 32 ? "red" : v >= 25 ? "amber" : "green") },
  ];
  return rows.map((r) => ({ ...r, state: r.v === null ? "na" : r.st(r.v), display: r.v === null ? null : r.fmt(r.v) }));
}

/* ---------- lens 2 ---------- */
function lens2Rows(det, ai) {
  const tpe = num(det?.tpe?.v), cpi = num(det?.cpi_yoy?.v);
  const rule20 = tpe !== null && cpi !== null ? +(tpe + cpi).toFixed(1) : null;
  const vg = det?.vg, sloos = det?.sloos;
  const rows = [
    { name: "Consumer Confidence > 110", sub: "Conference Board index", tier: "AI", rule: "Triggered if > 110",
      tipT: "Consumers are euphoric — a mood common near market tops.", tipN: "Consumers are not euphoric — this top-marker is quiet.",
      v: num(ai?.cc?.v), meta: ai?.cc, disp: (v) => v.toFixed(1), trig: (v) => v > 110 },
    { name: "Retail Euphoria", sub: "AAII % bulls", tier: "AI", rule: "Triggered if bulls > 40%",
      tipT: "Small investors are unusually bullish — historically a contrarian warning.", tipN: "Small investors are not euphoric.",
      v: num(ai?.aaii?.v), meta: ai?.aaii, disp: (v) => `${v.toFixed(1)}% bulls`, trig: (v) => v > 40 },
    { name: "Manager Bullishness", sub: "NAAIM equity exposure", tier: "AI", rule: "Triggered if > 90 (all-in)",
      tipT: "Professional managers are nearly all-in — little cash left to push prices higher.", tipN: "Managers still hold cash — not all-in yet.",
      v: num(ai?.naaim?.v), meta: ai?.naaim, disp: (v) => v.toFixed(1), trig: (v) => v > 90 },
    { name: "Growth-Expectation Froth", sub: "S&P 500 forward P/E", tier: "AI", rule: "Triggered if > 19× (vs ~16–18× long-run avg)",
      tipT: "Investors are paying a premium for future profits — stocks are expensive.", tipN: "Pricing of future profits is not extreme.",
      v: num(ai?.fpe?.v), meta: ai?.fpe, disp: (v) => `${v.toFixed(1)}×`, trig: (v) => v > 19 },
    { name: "Deal & IPO Froth", sub: "M&A + IPO issuance", tier: "AI", rule: "Triggered if at/near record volume",
      tipT: "Wall Street deal-making is at fever pitch — classic late-cycle behavior.", tipN: "Deal-making is not at a frenzy.",
      v: ai?.deal?.t === true ? 1 : ai?.deal?.t === false ? 0 : null, meta: ai?.deal,
      disp: () => (ai?.deal?.t ? "Record pace" : "Not at records"), qual: ai?.deal?.e, trig: (v) => v === 1 },
    { name: "Rule of 20", sub: "trailing P/E + CPI YoY", tier: "DET", rule: "Triggered if sum > 20",
      tipT: "Price plus inflation says the market is running hot.", tipN: "Price plus inflation is not in the danger zone.",
      v: rule20, meta: det?.tpe ? { d: `${det?.tpe?.d} + CPI ${det?.cpi_yoy?.d ?? ""}`, src: "multpl.com + FRED (computed)" } : null,
      disp: (v) => `${v} (P/E ${tpe} + CPI ${cpi}%)`, trig: (v) => v > 20 },
    { name: "Value vs Growth (6m)", sub: "RPV vs RPG total return", tier: "DET",
      rule: "Triggered if growth leads (late-cycle speculation); eased if value leads",
      tipT: "Speculative growth stocks are leading — a late-cycle pattern.", tipN: "Steadier value stocks are leading — speculation is cooling.",
      v: vg ? (vg.lead === "growth" ? 1 : 0) : null, meta: vg,
      disp: () => `${vg.lead === "growth" ? "Growth" : "Value"} leads · V ${vg.value_6m > 0 ? "+" : ""}${vg.value_6m}% vs G ${vg.growth_6m > 0 ? "+" : ""}${vg.growth_6m}%`,
      trig: (v) => v === 1 },
    { name: "Inverted Yield Curve", sub: "same 10y−3m as Lens 1", tier: "DET", rule: "Triggered if spread < 0",
      tipT: "The bond market’s recession warning is ON.", tipN: "No inversion — the bond market is not warning here.",
      v: num(det?.yc?.v), meta: det?.yc, disp: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`, trig: (v) => v < 0 },
    { name: "Credit Complacency", sub: "Chicago Fed NFCI", tier: "DET", rule: "Triggered if < 0 (looser-than-average conditions)",
      tipT: "Money is unusually easy — complacency like this builds before turns.", tipN: "Financial conditions are not unusually loose.",
      v: num(det?.nfci?.v), meta: det?.nfci, disp: (v) => v.toFixed(2), trig: (v) => v < 0 },
    { name: "Tightening Credit", sub: "Fed SLOOS, net % tightening C&I", tier: "DET",
      rule: "Triggered if net tightening > 0 and rising",
      tipT: "Banks are making loans harder to get — credit is tightening.", tipN: "Banks are still lending freely.",
      v: num(sloos?.v), meta: sloos,
      disp: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}% net · ${sloos.dir} (prev ${sloos.prev > 0 ? "+" : ""}${sloos.prev}%)`,
      trig: (v) => v > 0 && sloos?.dir === "rising" },
  ];
  return rows.map((r) => ({ ...r, state: r.v === null ? "na" : r.trig(r.v) ? "trig" : "not", display: r.v === null ? null : r.disp(r.v) }));
}

/* ---------- lens 3 ---------- */
function lens3State(det) {
  const t = det?.trend;
  if (!t) return { state: "na" };
  const s50 = num(t.s50), s150 = num(t.s150), px = num(t.px);
  if (s50 === null || s150 === null) return { state: "na", px, t };
  let state = "green";
  if (s50 < s150) state = t.sl50 === "falling" && (t.sl150 === "falling" || t.sl150 === "flat") ? "red" : "amber";
  return { state, px, s50, s150, sl50: t.sl50, sl150: t.sl150, t };
}

/* ---------- atoms ---------- */
function Dot({ s }) {
  return <span style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor(s), boxShadow: s !== "na" ? `0 0 8px ${dotColor(s)}66` : "none", display: "inline-block", flexShrink: 0, marginTop: 5 }} />;
}
function TierBadge({ tier, stale }) {
  const col = tier === "DET" ? C.green : C.blue;
  return (
    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, padding: "2px 6px", borderRadius: 4, border: `1px solid ${col}55`, color: col, marginRight: 6 }}>
      {tier === "DET" ? "LIVE API" : "AI SEARCH"}{stale ? " · STALE?" : ""}
    </span>
  );
}
function SourceLine({ meta, tier }) {
  if (!meta || (!meta.src && !meta.d)) return null;
  const stale = tier === "AI" && looksStale(meta);
  return (
    <div style={{ fontFamily: MONO, fontSize: 10, color: stale ? C.amber : C.faint, marginTop: 6 }}>
      <TierBadge tier={tier} stale={stale} />
      {meta.src ? `src: ${meta.src}` : ""}{meta.src && meta.d ? " · " : ""}{meta.d ? `as of ${meta.d}` : ""}
    </div>
  );
}
function Unavailable() {
  return (
    <div style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>
      DATA UNAVAILABLE
      <div style={{ fontSize: 10, marginTop: 2 }}>no verified source — not estimated</div>
    </div>
  );
}
function SectionHead({ label, title, desc }) {
  return (
    <div style={{ margin: "44px 0 14px" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 3, color: C.blue, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 21, fontWeight: 700, color: C.text, marginTop: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: 13, color: C.mute, marginTop: 3 }}>{desc}</div>}
    </div>
  );
}

/* ---------- signal map chart (v2026:07:02-15:51) ----------
   S&P 500 with 50d (blue) / 150d (green) SMAs and honestly-scoped historical bands:
   - red band   = Lens 1 proxy: Sahm Rule >= 0.50 (FRED, from 1959)
   - amber band = Lens 1 proxy: 10y-3m curve inverted (FRED, from 1982)
   - red ribbon = Lens 3: 50d SMA below 150d SMA (computed from the closes)
   Lens 2 has NO reconstructible free-data history — only today's live froth % is marked (gold dot).
   Hand-rolled SVG on purpose: zero new npm dependencies. */
const RANGES = ["6m", "1y", "5y", "all"];
const idxFor = (dates, d) => {
  if (d <= dates[0]) return 0;
  if (d >= dates[dates.length - 1]) return dates.length - 1;
  let lo = 0, hi = dates.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; }
  return lo;
};
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ChartSection({ frothPct }) {
  const [range, setRange] = useState("1y");
  const [cache, setCache] = useState({});
  const cur = cache[range] || { status: "idle" };

  useEffect(() => {
    if (cache[range]) return;
    setCache((p) => ({ ...p, [range]: { status: "loading" } }));
    fetch(`${API}?chart=${range}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => setCache((p) => ({ ...p, [range]: j.error ? { status: "error", err: j.error } : { status: "done", data: j } })))
      .catch((e) => setCache((p) => ({ ...p, [range]: { status: "error", err: e.message } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const ch = cur.data?.chart;
  const useLog = range === "5y" || range === "all";
  const W = 820, H = 380, m = { l: 58, r: 16, t: 16, b: 46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const ribbonY = H - m.b + 8, ribbonH = 6;

  let svgBody = null, disclosure = null;
  if (ch && ch.t.length > 1) {
    const { t, c, s50, s150, bands } = ch;
    const N = t.length;
    const vals = [...c, ...s50.filter((x) => x != null), ...s150.filter((x) => x != null)];
    const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.03;
    const yPos = (v) => {
      const f = useLog ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo);
      return m.t + (1 - f) * ph;
    };
    const xPos = (i) => m.l + (i / (N - 1)) * pw;
    const path = (arr) => {
      let d = "", pen = false;
      for (let i = 0; i < N; i++) {
        const v = arr[i];
        if (v == null) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    const bandRects = (list, fill, opacity) =>
      (list || []).filter((b) => !(b.b < t[0] || b.a > t[N - 1])).map((b, k) => {
        const x1 = xPos(idxFor(t, b.a)), x2 = xPos(idxFor(t, b.b));
        return <rect key={k} x={x1} y={m.t} width={Math.max(x2 - x1, 1.5)} height={ph} fill={fill} opacity={opacity} />;
      });
    const ribbonRects = (list) =>
      (list || []).filter((b) => !(b.b < t[0] || b.a > t[N - 1])).map((b, k) => {
        const x1 = xPos(idxFor(t, b.a)), x2 = xPos(idxFor(t, b.b));
        return <rect key={k} x={x1} y={ribbonY} width={Math.max(x2 - x1, 1.5)} height={ribbonH} rx={1} fill={C.red} opacity={0.85} />;
      });
    const yTicks = useLog
      ? [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 4000, 8000].filter((v) => v >= lo && v <= hi)
      : Array.from({ length: 5 }, (_, i) => Math.round(lo + (i * (hi - lo)) / 4));
    const xTickIdx = Array.from({ length: 6 }, (_, i) => Math.round((i * (N - 1)) / 5));
    const xLabel = (d) => (range === "5y" || range === "all") ? d.slice(0, 4) : `${MO[+d.slice(5, 7) - 1]} '${d.slice(2, 4)}`;

    svgBody = (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="S&P 500 signal map">
        {bandRects(bands.lens1_curve, C.amber, 0.10)}
        {bandRects(bands.lens1_sahm, C.red, 0.14)}
        {yTicks.map((v, k) => (
          <g key={k}>
            <line x1={m.l} x2={W - m.r} y1={yPos(v)} y2={yPos(v)} stroke={C.line} strokeWidth="0.6" />
            <text x={m.l - 8} y={yPos(v) + 3.5} textAnchor="end" fontSize="10.5" fill={C.faint} fontFamily={MONO}>{v.toLocaleString()}</text>
          </g>
        ))}
        {xTickIdx.map((i, k) => (
          <text key={k} x={xPos(i)} y={H - m.b + 30} textAnchor="middle" fontSize="10.5" fill={C.faint} fontFamily={MONO}>{xLabel(t[i])}</text>
        ))}
        {ribbonRects(bands.lens3_break)}
        <text x={m.l} y={ribbonY + ribbonH + 12} fontSize="8.5" fill={C.faint} fontFamily={MONO}>LENS 3: 50d below 150d</text>
        <path d={path(s150)} fill="none" stroke={C.green} strokeWidth="1.6" />
        <path d={path(s50)} fill="none" stroke={C.blue} strokeWidth="1.6" />
        <path d={path(c)} fill="none" stroke={C.text} strokeWidth="1.8" />
        <circle cx={xPos(N - 1)} cy={yPos(c[N - 1])} r="4.5" fill={C.gold} stroke="#141005" strokeWidth="1.5" />
        <text x={xPos(N - 1) - 8} y={yPos(c[N - 1]) - 10} textAnchor="end" fontSize="10.5" fill={C.gold} fontFamily={MONO}>
          Lens 2 now: {frothPct === null ? "—" : `${frothPct}% triggered`}
        </text>
      </svg>
    );
    disclosure = (
      <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, marginTop: 8, lineHeight: 1.7 }}>
        {useLog ? "log scale" : "linear scale"} · {ch.sampled} · src: Yahoo Finance ^GSPC (prices from {ch.coverage.px_from}, SMAs computed on daily closes) + FRED (Sahm from {ch.coverage.sahm_from ?? "n/a"}, 10y−3m from {ch.coverage.curve_from ?? "n/a"})
        <br />
        Lens 1 bands are a disclosed 2-of-7 PROXY (Sahm ≥ 0.50 red · curve inverted amber), not the full 7-gauge dashboard. Lens 2 has no reconstructible free-data history — only today's live reading is marked. Band legibility: runs &lt;5 obs dropped, gaps ≤10 obs merged.
        {ch.errors?.length > 0 && <span style={{ color: C.amber }}> · warnings: {ch.errors.join(" · ")}</span>}
      </div>
    );
  }

  return (
    <div>
      <SectionHead label="Signal Map" title="Where the lenses fired, on the chart" desc="S&P 500 with 50-day (blue) and 150-day (green) moving averages, plus honestly-reconstructible historical signals." />
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)}
              style={{ background: range === r ? C.gold : "transparent", color: range === r ? "#141005" : C.mute, border: `1px solid ${range === r ? C.gold : C.line}`, borderRadius: 6, padding: "5px 14px", fontFamily: MONO, fontSize: 11.5, fontWeight: 600, cursor: "pointer", letterSpacing: 1 }}>
              {r.toUpperCase()}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontFamily: MONO, fontSize: 9.5, color: C.mute }}>
            <span><span style={{ color: C.text }}>—</span> S&amp;P 500</span>
            <span><span style={{ color: C.blue }}>—</span> 50d SMA</span>
            <span><span style={{ color: C.green }}>—</span> 150d SMA</span>
            <span><span style={{ background: C.red, opacity: 0.5, display: "inline-block", width: 10, height: 8 }} /> Sahm ≥ 0.5</span>
            <span><span style={{ background: C.amber, opacity: 0.4, display: "inline-block", width: 10, height: 8 }} /> Curve inverted</span>
          </div>
        </div>
        {cur.status === "loading" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 30, color: C.mute, fontSize: 13 }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${C.line}`, borderTopColor: C.blue, display: "inline-block", animation: "spin .8s linear infinite" }} />
            Loading {range.toUpperCase()} price history…
          </div>
        )}
        {cur.status === "error" && (
          <div style={{ color: C.red, fontSize: 13, padding: 16 }}>
            Chart data failed: {cur.err}{" "}
            <button onClick={() => setCache((p) => { const q = { ...p }; delete q[range]; return q; })}
              style={{ background: "none", border: `1px solid ${C.line}`, color: C.text, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Retry</button>
          </div>
        )}
        {svgBody}
        {disclosure}
      </div>
    </div>
  );
}

/* ---------- Japan Lens helpers (v2026:07:02-18:24) ----------
   japanWorst(): worst gauge state for the OVERALL banner override.
   KEEP THRESHOLDS IN SYNC with the JapanLens rows below (same three rules). */
function japanWorst(jp) {
  const jgb = jp?.jgb, yen = jp?.yen, diff = jp?.diff;
  const jgbV = jgb && jgb.d10_3m_bp != null
    ? (jgb.d30_3m_bp != null ? Math.max(jgb.d10_3m_bp, jgb.d30_3m_bp) : jgb.d10_3m_bp) : null;
  const yenApp = yen && typeof yen.chg_1m_pct === "number" ? -yen.chg_1m_pct : null;
  const compV = diff && typeof diff.compress_3m_bp === "number" ? diff.compress_3m_bp : null;
  const st = [
    jgbV == null ? null : jgbV >= 80 ? "red" : jgbV >= 40 ? "amber" : "green",
    yenApp == null ? null : yenApp >= 6 ? "red" : yenApp >= 3 ? "amber" : "green",
    compV == null ? null : compV >= 100 ? "red" : compV >= 50 ? "amber" : "green",
  ].filter(Boolean);
  const worst = !st.length ? "na" : st.includes("red") ? "red" : st.includes("amber") ? "amber" : "green";
  // CoT early-warning (amber-grade, never red): 4-week spec short-covering >= +60k contracts off a short base.
  // Calibrated on the full 1986→ weekly distribution (~1% of weeks). Verified against history: this signal
  // fired BEFORE the yen gauge crossed amber ahead of both the Aug-2007 and Aug-2024 unwinds — but it also
  // fires in some benign covering episodes (2003, 2006, 2011), so it lifts green→amber only.
  const cot = jp?.cot;
  const cotUnwind = !!(cot && typeof cot.chg_4w === "number" && cot.chg_4w >= 60000 && cot.was_short);
  return { worst, cotUnwind };
}

// One canonical Japan-watch message consumed by the banner, the Lens Summary and the Japan section —
// three hand-written phrasings previously drifted apart; a single source keeps them aligned forever.
// eff = effective display state (banner-lift semantics: green + CoT early-warning renders amber).
function jpMessage(jpS) {
  const eff = jpS.worst === "green" && jpS.cotUnwind ? "amber" : jpS.worst;
  const base =
    jpS.worst === "red" ? "Carry unwind IN PROGRESS — borrowed-yen bets are being forced shut worldwide. Aug-2024-type shock risk." :
    jpS.worst === "amber" ? "Pressure building — rising Japanese rates / a firmer yen are squeezing the profit on borrowed-yen bets. Not an unwind yet, but the fuel for one is accumulating; watch the yen for the spark." :
    jpS.worst === "green" ? "Quiet — the carry trade is intact, no unwind under way." :
    "No readings available.";
  return { eff, txt: base + (jpS.cotUnwind ? " EARLY WARNING: speculators are covering yen shorts at historic speed." : "") };
}

/* Carry-trade chart: CFTC CoT net non-commercial JPY futures position (weekly, 1986→) + USD/JPY.
   Net SHORT yen (below zero) = carry trade ON. Record short and latest are COMPUTED server-side
   from the full series — never hardcoded. Hand-rolled SVG, no new dependencies. */
function JapanCarryChart() {
  const [range, setRange] = useState("5y");
  const [cache, setCache] = useState({});
  const cur = cache[range] || { status: "idle" };

  useEffect(() => {
    if (cache[range]) return;
    setCache((p) => ({ ...p, [range]: { status: "loading" } }));
    fetch(`${API}?jchart=${range}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => setCache((p) => ({ ...p, [range]: j.error ? { status: "error", err: j.error } : { status: "done", data: j } })))
      .catch((e) => setCache((p) => ({ ...p, [range]: { status: "error", err: e.message } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const j = cur.data?.jchart;
  const W = 820, H = 300, m = { l: 66, r: 60, t: 16, b: 34 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const kfmt = (v) => `${v < 0 ? "\u2212" : "+"}${Math.abs(Math.round(v / 1000))}k`;

  let body = null, head = null, concl = null, disclosure = null;
  if (j && j.t.length > 1) {
    // Trend conclusion — thresholds calibrated on the full 1986→ weekly distribution (frozen methodology,
    // documented in the rule line below); all readings are live server-computed values.
    const tr = j.trend;
    if (tr && tr.chg_4w != null && j.latest) {
      const netNow = j.latest.v;
      const k = (v) => `${v < 0 ? "\u2212" : "+"}${Math.abs(Math.round(v / 1000))}k`;
      let cc;
      if (netNow >= 0) cc = { txt: `CARRY UNWOUND \u2014 speculators are net LONG yen (${netNow.toLocaleString()}). The Japan transmission channel is discharged.`, col: C.green };
      else if (tr.chg_4w >= 60000) cc = { txt: `VIOLENT UNWIND UNDERWAY \u2014 shorts covered ${k(tr.chg_4w)} contracts in 4 weeks, a speed seen in only ~1% of weeks since 1986, almost exclusively around major yen shocks (2007, Aug 2024).`, col: C.red };
      else if (tr.chg_4w >= 25000) cc = { txt: `SHORTS COVERING \u2014 ${k(tr.chg_4w)} in 4 weeks (top ~8% of covering speeds since 1986). Early unwind pressure; watch for acceleration.`, col: C.amber };
      else {
        const building = tr.chg_13w != null && tr.chg_13w <= -20000;
        const extreme = tr.pctile_more_short != null && tr.pctile_more_short >= 95;
        if (building && extreme) cc = { txt: `CARRY BUILDING AT HISTORIC EXTREME \u2014 shorts grew ${k(-tr.chg_13w)} contracts in 13 weeks; the position is now more short than ${tr.pctile_more_short}% of all weeks since 1986. No unwind underway \u2014 but the larger the position, the more violent the eventual snap.`, col: C.gold };
        else if (extreme) cc = { txt: `CARRY AT HISTORIC EXTREME, holding steady \u2014 more short than ${tr.pctile_more_short}% of all weeks since 1986. No unwind pressure yet.`, col: C.gold };
        else if (building) cc = { txt: `Carry building \u2014 shorts grew ${k(-tr.chg_13w)} over 13 weeks, positioning not yet at historic extremes (${tr.pctile_more_short}th percentile).`, col: C.mute };
        else cc = { txt: `Carry on but stable \u2014 net short yen at the ${tr.pctile_more_short}th percentile of history, no notable build or unwind over the past quarter.`, col: C.mute };
      }
      concl = (
        <div style={{ border: `1px solid ${C.line}`, borderLeft: `3px solid ${cc.col}`, background: C.panel, borderRadius: 8, padding: "10px 14px", margin: "4px 0 10px", fontSize: 13, color: cc.col, fontWeight: 500 }}>
          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 2, color: C.faint, display: "block", marginBottom: 4 }}>TREND CONCLUSION</span>
          {cc.txt}
        </div>
      );
    }
    const { t, net, fx } = j;
    const N = t.length;
    const nLoRaw = Math.min(...net, 0), nHiRaw = Math.max(...net, 0);
    const pad = (nHiRaw - nLoRaw) * 0.08 || 1;
    const nLo = nLoRaw - pad, nHi = nHiRaw + pad;
    const yN = (v) => m.t + (1 - (v - nLo) / (nHi - nLo)) * ph;
    const fxVals = fx.filter((x) => x != null);
    const fLo = fxVals.length ? Math.min(...fxVals) * 0.99 : 0, fHi = fxVals.length ? Math.max(...fxVals) * 1.01 : 1;
    const yF = (v) => m.t + (1 - (v - fLo) / (fHi - fLo)) * ph;
    const x = (i) => m.l + (i / (N - 1)) * pw;

    let area = `M${x(0).toFixed(1)},${yN(0).toFixed(1)}`;
    let line = "";
    for (let i = 0; i < N; i++) {
      area += `L${x(i).toFixed(1)},${yN(net[i]).toFixed(1)}`;
      line += `${i ? "L" : "M"}${x(i).toFixed(1)},${yN(net[i]).toFixed(1)}`;
    }
    area += `L${x(N - 1).toFixed(1)},${yN(0).toFixed(1)}Z`;
    let fxPath = "", pen = false;
    for (let i = 0; i < N; i++) {
      if (fx[i] == null) { pen = false; continue; }
      fxPath += `${pen ? "L" : "M"}${x(i).toFixed(1)},${yF(fx[i]).toFixed(1)}`;
      pen = true;
    }
    const nTicks = Array.from({ length: 5 }, (_, k) => nLo + (k * (nHi - nLo)) / 4);
    const fTicks = fxVals.length ? Array.from({ length: 4 }, (_, k) => fLo + (k * (fHi - fLo)) / 3) : [];
    const xTickIdx = Array.from({ length: 6 }, (_, k) => Math.round((k * (N - 1)) / 5));
    const xLabel = (d) => (range === "1y" ? `${MO[+d.slice(5, 7) - 1]} '${d.slice(2, 4)}` : d.slice(0, 4));
    const recIdx = j.record_short && j.record_short.d >= t[0] ? t.indexOf(j.record_short.d) : -1;

    body = (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Yen carry trade positioning">
        {nTicks.map((v, k) => (
          <g key={k}>
            <line x1={m.l} x2={W - m.r} y1={yN(v)} y2={yN(v)} stroke={C.line} strokeWidth="0.6" />
            <text x={m.l - 8} y={yN(v) + 3.5} textAnchor="end" fontSize="10.5" fill={C.faint} fontFamily={MONO}>{kfmt(v)}</text>
          </g>
        ))}
        {fTicks.map((v, k) => (
          <text key={k} x={W - m.r + 8} y={yF(v) + 3.5} textAnchor="start" fontSize="10.5" fill={C.blue} fontFamily={MONO} opacity="0.8">{v.toFixed(0)}</text>
        ))}
        {xTickIdx.map((i, k) => (
          <text key={k} x={x(i)} y={H - m.b + 26} textAnchor="middle" fontSize="10.5" fill={C.faint} fontFamily={MONO}>{xLabel(t[i])}</text>
        ))}
        <path d={area} fill={C.gold} opacity="0.22" />
        <path d={line} fill="none" stroke={C.gold} strokeWidth="1.6" />
        <line x1={m.l} x2={W - m.r} y1={yN(0)} y2={yN(0)} stroke={C.mute} strokeWidth="1" strokeDasharray="4 4" />
        <text x={m.l + 4} y={yN(0) - 5} fontSize="9.5" fill={C.mute} fontFamily={MONO}>0 — below = net SHORT yen = carry ON</text>
        {fxPath && <path d={fxPath} fill="none" stroke={C.blue} strokeWidth="1.4" opacity="0.9" />}
        {recIdx >= 0 && (
          <g>
            <circle cx={x(recIdx)} cy={yN(net[recIdx])} r="4" fill={C.red} stroke={C.bg} strokeWidth="1.5" />
            <text x={x(recIdx)} y={yN(net[recIdx]) + 16} textAnchor="middle" fontSize="9.5" fill={C.red} fontFamily={MONO}>record {kfmt(j.record_short.v)}</text>
          </g>
        )}
        <circle cx={x(N - 1)} cy={yN(net[N - 1])} r="4" fill={C.gold} stroke={C.bg} strokeWidth="1.5" />
      </svg>
    );
    head = (
      <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.text, marginBottom: 6 }}>
        Net spec JPY position: <span style={{ color: C.gold, fontWeight: 600, fontSize: 19 }}>{j.latest.v.toLocaleString()}</span> contracts ({j.latest.d})
        <span style={{ color: C.faint }}> · all-time record short {j.record_short.v.toLocaleString()} ({j.record_short.d})</span>
      </div>
    );
    disclosure = (
      <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, marginTop: 6, lineHeight: 1.7 }}>
        {j.sampled} · net = non-commercial long − short futures contracts · coverage from {j.coverage.from} ({j.coverage.weeks} weeks) · latest/record/trend computed from the full series, never hardcoded
        <br />conclusion rules (calibrated on the full 1986→ distribution): net ≥ 0 unwound · 4w covering ≥ +60k red (≈ rarest 1% of weeks) · ≥ +25k amber (≈ top 8%) · 13w build ≤ −20k building · percentile ≥ 95 historic extreme
        <br />src: {j.src}
        {j.errors?.length > 0 && <span style={{ color: C.amber }}> · warnings: {j.errors.join(" · ")}</span>}
      </div>
    );
  }

  return (
    <div style={{ background: C.panelSoft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 14px 10px", marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, marginRight: 6 }}>The Carry Trade, Measured <span style={{ color: C.faint, fontWeight: 400, fontSize: 12.5 }}>(speculative yen positioning)</span></div>
        {["1y", "5y", "all"].map((r) => (
          <button key={r} onClick={() => setRange(r)}
            style={{ background: range === r ? C.gold : "transparent", color: range === r ? "#141005" : C.mute, border: `1px solid ${range === r ? C.gold : C.line}`, borderRadius: 6, padding: "4px 12px", fontFamily: MONO, fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: 1 }}>
            {r.toUpperCase()}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontFamily: MONO, fontSize: 9.5, color: C.mute }}>
          <span><span style={{ color: C.gold }}>■</span> net JPY position (left)</span>
          <span><span style={{ color: C.blue }}>—</span> USD/JPY (right)</span>
        </div>
      </div>
      {head}
      {concl}
      {cur.status === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 24, color: C.mute, fontSize: 13 }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${C.line}`, borderTopColor: C.blue, display: "inline-block", animation: "spin .8s linear infinite" }} />
          Loading CFTC positioning history…
        </div>
      )}
      {cur.status === "error" && (
        <div style={{ color: C.red, fontSize: 13, padding: 12 }}>
          Carry chart failed: {cur.err}{" "}
          <button onClick={() => setCache((p) => { const q = { ...p }; delete q[range]; return q; })}
            style={{ background: "none", border: `1px solid ${C.line}`, color: C.text, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Retry</button>
        </div>
      )}
      {body}
      {disclosure}
    </div>
  );
}

/* ---------- Japan Lens: carry-unwind watch (v2026:07:02-17:01) ----------
   Deterministic (MOF daily JGB yields + FRED). Measures the Japan transmission channel:
   fast JGB tightening + yen snap-back = carry-trade unwind (the Aug 5, 2024 mechanism).
   DELIBERATELY EXCLUDED from the Lens-2 froth % to preserve that composite's
   "65-70% ≈ prior peaks" band comparability. Thresholds are disclosed methodology. */
function JapanLens({ jp }) {
  const jgb = jp?.jgb, yen = jp?.yen, diff = jp?.diff;
  const jgbV = jgb && jgb.d10_3m_bp != null
    ? (jgb.d30_3m_bp != null ? Math.max(jgb.d10_3m_bp, jgb.d30_3m_bp) : jgb.d10_3m_bp)
    : null;
  const yenApp = yen && typeof yen.chg_1m_pct === "number" ? +(-yen.chg_1m_pct).toFixed(2) : null; // positive = yen strengthening
  const compV = diff && typeof diff.compress_3m_bp === "number" ? diff.compress_3m_bp : null;
  const bp = (v) => `${v > 0 ? "+" : ""}${v}bp`;

  const rows = [
    {
      name: "JGB Tightening Shock", sub: "10y & 30y JGB yields, 3-month change",
      note: "Fast JGB yield rises squeeze the yen carry trade and pull global long rates up. Speed matters, not level — 2025's slow rise was orderly; the danger is a spike.",
      rule: "Green < +40bp · Amber +40–79bp · Red ≥ +80bp (max of 10y/30y over 3m)",
      tips: { green: "Japanese rates are rising slowly — manageable.", amber: "Japanese rates are rising fast — pressure building on the carry trade.", red: "Japanese rate shock — high risk of global spillover." },
      v: jgbV,
      display: jgbV != null && jgb ? `10y ${bp(jgb.d10_3m_bp)}${jgb.d30_3m_bp != null ? ` · 30y ${bp(jgb.d30_3m_bp)}` : ""}` : null,
      extra: jgb?.y10 ? `10y ${jgb.y10.v}% · 30y ${jgb.y30 ? jgb.y30.v + "%" : "n/a"}` : null,
      st: (v) => (v >= 80 ? "red" : v >= 40 ? "amber" : "green"),
      meta: jgb ? { d: `${jgb.from} → ${jgb.y10?.d}`, src: jgb.src } : null,
    },
    {
      name: "Yen Shock", sub: "USD/JPY, 1-month move",
      note: "Sharp yen strengthening is the unwind actually happening — the Aug 2024 flash crash saw ~8–12% yen appreciation in weeks. Yen weakening = carry being added (tinderbox grows).",
      rule: "Green < 3% yen appreciation/1m · Amber 3–5.9% · Red ≥ 6%",
      tips: { green: "The yen is calm — the big unwind is NOT happening.", amber: "The yen is strengthening — unwind pressure is building.", red: "The yen is surging — the unwind is happening NOW (Aug-2024-type risk)." },
      v: yenApp,
      display: yenApp != null && yen ? `¥${yen.usdjpy}/USD · yen ${yenApp > 0 ? "+" : ""}${yenApp}% 1m (${yenApp > 0 ? "strengthening" : "weakening"})` : null,
      st: (v) => (v >= 6 ? "red" : v >= 3 ? "amber" : "green"),
      meta: yen ? { d: `as of ${yen.d}`, src: yen.src } : null,
    },
    {
      name: "US−JP Yield Gap Compression", sub: "10y differential, 3-month change",
      note: "The gap is what makes the carry trade pay. Rapid compression (BOJ hiking into a Fed pivot) erodes it and pressures positions to unwind.",
      rule: "Green < +50bp compression/3m · Amber +50–99bp · Red ≥ +100bp",
      tips: { green: "The carry trade’s pay-off is intact.", amber: "The carry trade’s pay-off is shrinking — pressure to exit.", red: "The carry trade’s pay-off is collapsing — forced exits likely." },
      v: compV,
      display: compV != null && diff ? `US−JP ${diff.now_pct}% · ${compV >= 0 ? "compressed" : "widened"} ${Math.abs(compV)}bp 3m` : null,
      st: (v) => (v >= 100 ? "red" : v >= 50 ? "amber" : "green"),
      meta: diff ? { d: `US10y ${diff.us10}% as of ${diff.d}`, src: diff.src } : null,
    },
  ].map((r) => ({ ...r, state: r.v === null ? "na" : r.st(r.v) }));

  const states = rows.map((r) => r.state);
  // Canonical message via jpMessage() — identical to the banner and Lens Summary by construction.
  const jpM = jpMessage(japanWorst(jp));
  const read = { txt: jpM.txt, col: jpM.eff === "na" ? C.mute : dotColor(jpM.eff) };

  return (
    <div>
      <SectionHead label="Japan Lens · Carry-Unwind Watch" title="Is the Japan channel about to break?"
        desc="The global transmission risk from the Japanese bond market. Not counted in the Lens-2 froth % — different signal class (external fragility, not domestic cycle)." />
      <div style={{ marginBottom: 12, border: `1px solid ${C.line}`, borderLeft: `3px solid ${read.col}`, background: C.panel, borderRadius: 10, padding: "12px 16px", fontSize: 13.5, color: read.col, fontWeight: 500 }}>
        {read.txt}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Dot s={r.state} />
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{r.name} <span style={{ color: C.faint, fontWeight: 400, fontSize: 13 }}>({r.sub})</span></div>
              <div style={{ fontSize: 12.5, color: C.mute, marginTop: 3 }}>{r.note}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, marginTop: 5 }}>rule: {r.rule}</div>
              <SourceLine meta={r.meta} tier="DET" />
              {r.tips && r.state !== "na" && <div style={{ fontSize: 12.5, color: dotColor(r.state), marginTop: 6 }}>→ {r.tips[r.state]}</div>}
            </div>
            <div style={{ textAlign: "right", minWidth: 130, marginLeft: "auto", maxWidth: "100%" }}>
              {r.display === null ? <Unavailable /> : (
                <>
                  <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 600, color: dotColor(r.state) }}>{r.display}</div>
                  {r.extra && <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.mute, marginTop: 2 }}>{r.extra}</div>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {jp?.errors?.length > 0 && (
        <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: C.amber }}>fetcher warnings: {jp.errors.join(" · ")}</div>
      )}
      <JapanCarryChart />
    </div>
  );
}

/* ---------- main ---------- */
export default function App() {
  const [state, setState] = useState({ status: "loading", data: null, err: null });
  const [refreshing, setRefreshing] = useState(false);

  async function load(force) {
    force ? setRefreshing(true) : setState({ status: "loading", data: null, err: null });
    try {
      const r = await fetch(`${API}${force ? "?refresh=1&ai=1" : ""}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setState({ status: "done", data, err: null });
    } catch (e) {
      setState((s) => ({ status: s.data ? "done" : "error", data: s.data, err: e.message }));
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => { load(false); }, []);

  const det = state.data?.det, ai = state.data?.ai, meta = state.data?.meta;
  const rows1 = useMemo(() => lens1Rows(det, ai), [det, ai]);
  const rows2 = useMemo(() => lens2Rows(det, ai), [det, ai]);
  const t3 = useMemo(() => lens3State(det), [det]);

  const evald = rows2.filter((r) => r.state !== "na");
  const trigd = rows2.filter((r) => r.state === "trig");
  const frothPct = evald.length ? Math.round((trigd.length / evald.length) * 100) : null;
  const frothBand = frothPct === null ? "na" : frothPct >= 65 ? "peak" : frothPct >= 40 ? "building" : "low";

  const l1Evald = rows1.filter((r) => r.state !== "na").length;
  const l1Reds = rows1.filter((r) => r.state === "red").length;
  const l1Band = !l1Evald ? "na" : l1Reds >= 3 ? "red" : l1Reds >= 1 ? "amber" : "green";

  const jpS = japanWorst(state.data?.jp);
  const jpM = jpMessage(jpS);

  const banner = (() => {
    if (l1Band === "na" && frothBand === "na" && t3.state === "na")
      return { txt: state.status === "loading" ? "Loading readings…" : "No readings available.", col: C.mute };
    const econ = l1Band === "green" ? "Economy calm" : l1Band === "amber" ? "Economy mixed" : l1Band === "red" ? "Recession risk elevated" : "Economy: no data";
    const froth = frothBand === "low" ? "Froth low" : frothBand === "building" ? "Froth building" : frothBand === "peak" ? "Market frothy (peak-like)" : "Froth: no data";
    const trend = t3.state === "green" ? "Uptrend intact" : t3.state === "amber" ? "Trend wobbling" : t3.state === "red" ? "Trend broken" : "Trend: no data";
    let verdict = "";
    if (l1Band === "red" && t3.state === "red") verdict = " — the historic sell signal: elevated recession risk plus a trend break.";
    else if (t3.state === "red" && frothBand === "peak") verdict = " — trend break alongside high froth: defensive posture warranted.";
    else if (l1Band !== "red" && t3.state === "green") verdict = " — stay invested, stay disciplined.";
    let col = l1Band === "red" || t3.state === "red" ? C.red : frothBand === "peak" || l1Band === "amber" || t3.state === "amber" ? C.amber : C.green;
    let txt = `${econ} · ${froth} · ${trend}${verdict}`;
    // Japan Lens = OVERRIDE/AMPLIFIER, not a fourth averaged input: an unwind is a fast coincident
    // shock (Aug 2024: Lens 1 green, trend intact until the same week) and must never be diluted.
    if (jpS.worst === "red") col = C.red;
    else if (jpS.worst === "amber" && col === C.green) col = C.amber;
    if (jpS.cotUnwind && col === C.green) col = C.amber;
    return { txt, col, jp: { txt: jpM.txt, col: dotColor(jpM.eff) } };
  })();

  // Honest banner timestamp: the OLDEST fetched_at among the blocks feeding the read — server-side
  // cache means data time ≠ render time; the weakest link defines the read's freshness.
  const bannerAsOf = (() => {
    const ts = [meta?.det, meta?.ai, meta?.jp].filter((m) => m && m.fetched_at).map((m) => new Date(m.fetched_at).getTime());
    return ts.length ? new Date(Math.min(...ts)) : null;
  })();

  const tierNote = (m) => (m ? `${m.tier === "cache" ? `cached ${m.age_h}h ago` : "fetched live"}` : "—");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        button { -webkit-tap-highlight-color: transparent; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
      `}</style>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "max(24px, env(safe-area-inset-top)) 18px 60px" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 4, color: C.gold }}>TRILENS</div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: "6px 0 4px", letterSpacing: -0.5 }}>Recession &amp; Market-Peak Monitor</h1>
            <div style={{ fontSize: 13, color: C.mute }}>
              Three lenses: economy (1) · froth (2) · price trend (3). Froth alone rarely ends a bull — a trend break
              alongside high froth is the historic sell signal.
            </div>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing || state.status === "loading"}
            style={{ background: refreshing ? C.panel : C.gold, color: refreshing ? C.mute : "#141005", border: "none", borderRadius: 8, padding: "12px 18px", fontFamily: MONO, fontSize: 12.5, fontWeight: 600, cursor: refreshing ? "default" : "pointer", letterSpacing: 0.5 }}
          >
            {refreshing ? "REFRESHING… (AI ~60s)" : "FORCE FRESH READINGS"}
          </button>
        </div>

        <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, marginTop: 10, lineHeight: 1.7 }}>
          {APP_VERSION} · backend {meta?.version || "—"} · public APIs: {tierNote(meta?.det)} · AI web-search block: {tierNote(meta?.ai)}
          {state.err && <span style={{ color: C.red }}> · last request failed: {state.err}</span>}
        </div>

        {/* banner */}
        <div style={{ marginTop: 20, border: `1px solid ${C.line}`, borderLeft: `3px solid ${banner.col}`, background: C.panel, borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.faint, marginBottom: 6 }}>OVERALL READ</div>
          <div style={{ fontSize: 15, color: banner.col, fontWeight: 500 }}>{banner.txt}</div>
          {banner.jp && (
            <div style={{ fontSize: 13.5, color: banner.jp.col, fontWeight: 500, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.5, color: C.faint }}>JAPAN WATCH · </span>{banner.jp.txt}
            </div>
          )}
          {bannerAsOf && (
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, marginTop: 8 }}>
              read based on data fetched {bannerAsOf.toLocaleString()} (oldest of the source blocks)
            </div>
          )}
        </div>

        {/* per-lens summary — same aggregates and Japan override semantics as the banner above */}
        {(l1Band !== "na" || frothBand !== "na" || t3.state !== "na" || jpS.worst !== "na") && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", marginTop: 10 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.faint, marginBottom: 4 }}>LENS SUMMARY</div>
            {[
              { key: "L1", name: "LENS 1 · ECONOMY", s: l1Band,
                detail: l1Evald ? `${rows1.filter((r) => r.state === "green").length} green · ${rows1.filter((r) => r.state === "amber").length} amber · ${l1Reds} red of ${l1Evald}` : null,
                tip: l1Band === "green" ? "No recession signals from the economy." : l1Band === "amber" ? "Some economic warning lights are on — not a recession call yet." : l1Band === "red" ? "Multiple recession signals are firing." : "No data." },
              { key: "L2", name: "LENS 2 · FROTH", s: frothBand === "peak" ? "red" : frothBand === "building" ? "amber" : frothBand === "low" ? "green" : "na",
                detail: frothPct !== null ? `${trigd.length}/${evald.length} triggered (${frothPct}%)` : null,
                tip: frothBand === "low" ? "The mood is calm — not how tops usually look." : frothBand === "building" ? "Speculative behavior is building." : frothBand === "peak" ? "Looks and feels like previous peaks — fragile, but froth alone doesn’t time the fall." : "No data." },
              { key: "L3", name: "LENS 3 · PRICE TREND", s: t3.state,
                detail: t3.sl50 && t3.sl150 ? `50d ${t3.sl50} · 150d ${t3.sl150}` : null,
                tip: (t3.sl50 && t3.sl150
                  ? (t3.sl50 === "rising" && t3.sl150 === "rising" ? "Moving averages trending UP. "
                    : t3.sl50 === "falling" && t3.sl150 === "falling" ? "Moving averages trending DOWN. "
                    : "Moving averages mixed. ")
                  : "")
                  + (t3.state === "green" ? "The uptrend is intact — no sell signal."
                    : t3.state === "amber" ? "The trend is wobbling but the break is not confirmed."
                    : t3.state === "red" ? "The trend is broken — the historic ‘get defensive’ signal."
                    : "No data.") },
            ].map((L) => (
              <div key={L.key} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <Dot s={L.s} />
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.mute }}>{L.name}</div>
                  <div style={{ fontSize: 12.5, color: dotColor(L.s), marginTop: 3 }}>{L.tip}</div>
                </div>
                {L.detail && <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.faint, marginLeft: "auto", textAlign: "right" }}>{L.detail}</div>}
              </div>
            ))}
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.faint, margin: "12px 0 0", paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
              ADDITIONAL WATCH · JAPAN CARRY TRADE <span style={{ letterSpacing: 0.5 }}>(override/amplifier — not averaged into the three lenses)</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", padding: "8px 0 0" }}>
              <Dot s={jpM.eff} />
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: dotColor(jpM.eff), marginTop: 3 }}>
                  {jpM.txt}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* signal map — fetches independently so it renders even if the gauges block fails */}
        <ChartSection frothPct={frothPct} />

        {state.status === "loading" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 20, color: C.mute, fontSize: 13 }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${C.line}`, borderTopColor: C.blue, display: "inline-block", animation: "spin .8s linear infinite" }} />
            Loading readings from FRED, Yahoo Finance, multpl and the AI search block…
          </div>
        )}
        {state.status === "error" && (
          <div style={{ color: C.red, fontSize: 13, padding: 16 }}>
            Could not reach the data backend: {state.err}{" "}
            <button onClick={() => load(false)} style={{ background: "none", border: `1px solid ${C.line}`, color: C.text, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {state.status === "done" && (
          <>
            {/* LENS 1 */}
            <SectionHead label="Lens 1 · Recession-Risk Dashboard" title="Is a downturn coming?" desc="Leading & coincident indicators of an economic downturn." />
            <div style={{ display: "flex", gap: 14, fontSize: 12, color: C.mute, marginBottom: 12, flexWrap: "wrap" }}>
              <span><span style={{ color: C.green }}>●</span> Benign / no signal</span>
              <span><span style={{ color: C.amber }}>●</span> Watch / mixed</span>
              <span><span style={{ color: C.red }}>●</span> Elevated risk</span>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {rows1.map((r) => (
                <div key={r.name} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Dot s={r.state} />
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{r.name} <span style={{ color: C.faint, fontWeight: 400, fontSize: 13 }}>({r.sub})</span></div>
                    <div style={{ fontSize: 12.5, color: C.mute, marginTop: 3 }}>{r.note}</div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, marginTop: 5 }}>rule: {r.rule}</div>
                    <SourceLine meta={r.meta} tier={r.tier} />
                    {r.tips && r.state !== "na" && <div style={{ fontSize: 12.5, color: dotColor(r.state), marginTop: 6 }}>→ {r.tips[r.state]}</div>}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 110, marginLeft: "auto", maxWidth: "100%" }}>
                    {r.display === null ? <Unavailable /> : (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 600, color: dotColor(r.state) }}>{r.display}</div>
                        {r.extra && <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.mute, marginTop: 2 }}>{r.extra}</div>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* LENS 2 */}
            <SectionHead label="Lens 2 · Market-Peak Froth" title="Does positioning look like a top?" desc="A signal is triggered when it shows the euphoria or complacency typical of market tops." />
            <div style={{ background: `linear-gradient(135deg, ${C.panel}, #1A1710)`, border: `1px solid ${C.line}`, borderRadius: 12, padding: "18px 20px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, alignItems: "baseline" }}>
                <div>
                  <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 600, color: frothPct === null ? C.faint : C.gold }}>{frothPct === null ? "—" : `${frothPct}%`}</span>
                  <span style={{ fontSize: 13, color: C.mute, marginLeft: 10 }}>of peak signals triggered{evald.length ? ` (${trigd.length}/${evald.length} evaluable)` : ""}</span>
                </div>
                <div style={{ fontSize: 12.5, color: C.mute, maxWidth: 380 }}>
                  {frothBand === "peak" && "In line with levels typically seen at prior market peaks. Froth without a recession is the 2022 pattern, not the 2008 one."}
                  {frothBand === "building" && "Froth building but below typical peak readings."}
                  {frothBand === "low" && "Positioning not peak-like."}
                  {frothBand === "na" && "No gauges evaluable."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 14 }}>
                {rows2.map((r) => (
                  <div key={r.name} title={r.name} style={{ flex: 1, height: 10, borderRadius: 3, background: r.state === "trig" ? C.gold : r.state === "not" ? "#2A3145" : "#1A2030", border: r.state === "na" ? `1px dashed ${C.line}` : "none" }} />
                ))}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, marginTop: 6 }}>gold = triggered · slate = not yet / eased · dashed = unavailable (excluded from %)</div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {rows2.map((r) => (
                <div key={r.name} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <Dot s={r.state === "trig" ? "red" : r.state === "not" ? "green" : "na"} />
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>{r.sub}</div>
                    {r.qual && <div style={{ fontSize: 11.5, color: C.mute, marginTop: 3, fontStyle: "italic" }}>{r.qual}</div>}
                    <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, marginTop: 4 }}>rule: {r.rule}</div>
                    <SourceLine meta={r.meta} tier={r.tier} />
                    {r.state !== "na" && <div style={{ fontSize: 12.5, color: dotColor(r.state === "trig" ? "red" : "green"), marginTop: 6 }}>→ {r.state === "trig" ? r.tipT : r.tipN}</div>}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 130, marginLeft: "auto" }}>
                    {r.display === null ? <Unavailable /> : (
                      <>
                        <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 600, color: dotColor(r.state === "trig" ? "red" : "green") }}>{r.display}</div>
                        <div style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, marginTop: 3, color: r.state === "trig" ? C.red : C.green }}>
                          {r.state === "trig" ? "● Triggered" : "○ Not yet / eased"}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* JAPAN LENS — carry-unwind watch (excluded from Lens-2 froth % by design) */}
            <JapanLens jp={state.data?.jp} />

            {/* LENS 3 */}
            <SectionHead label="Lens 3 · Price Trend" title="Has the trend actually broken?" desc="50-day vs 150-day SMA on daily candles, computed server-side from Yahoo Finance closes. This is the act trigger." />
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "16px 18px", display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Dot s={t3.state} />
              <div style={{ flex: "1 1 260px" }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>50-day vs 150-day SMA <span style={{ color: C.faint, fontWeight: 400, fontSize: 13 }}>(daily candles)</span></div>
                <div style={{ fontSize: 12.5, color: C.mute, marginTop: 4, lineHeight: 1.5 }}>
                  A genuine bear signal needs the 50-day to cross <em>below</em> the 150-day <strong>and</strong> both lines
                  to flatten or turn down — confirming a real trend change rather than a brief dip. Until then, the uptrend is intact.
                </div>
                {t3.state !== "na" ? (
                  <div style={{ fontFamily: MONO, fontSize: 12.5, marginTop: 10, color: C.text }}>
                    S&amp;P 500 {t3.px !== null ? t3.px.toLocaleString() : "—"} · 50d {t3.s50.toLocaleString()} ({t3.sl50 || "slope n/a"}) · 150d {t3.s150.toLocaleString()} ({t3.sl150 || "slope n/a"})
                    <SourceLine meta={det?.trend} tier="DET" />
                    {t3.state !== "na" && <div style={{ fontSize: 12.5, color: dotColor(t3.state), marginTop: 6 }}>→ {t3.state === "green" ? "The uptrend is intact — no sell signal." : t3.state === "amber" ? "The trend is wobbling but the break is not confirmed." : "The trend is broken — the historic ‘get defensive’ signal."}</div>}
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}><Unavailable /></div>
                )}
              </div>
              <div style={{ textAlign: "right", minWidth: 110, marginLeft: "auto" }}>
                <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 600, color: dotColor(t3.state) }}>
                  {t3.state === "green" ? "UPTREND" : t3.state === "amber" ? "UNCONFIRMED" : t3.state === "red" ? "TREND BREAK" : "—"}
                </div>
              </div>
            </div>

            {det?.errors?.length > 0 && (
              <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 10.5, color: C.amber }}>
                fetcher warnings: {det.errors.join(" · ")}
              </div>
            )}
          </>
        )}

        {/* footer */}
        <div style={{ marginTop: 40, borderTop: `1px solid ${C.line}`, paddingTop: 16, fontSize: 11.5, color: C.faint, lineHeight: 1.6 }}>
          <strong style={{ color: C.mute }}>Data honesty</strong> — every reading is fetched from its named source with the as-of period shown. LIVE API = deterministic public data (FRED, Yahoo Finance, multpl). AI SEARCH = Claude with live web search, used only for series that publish no free API (ISM, LEI, Consumer Confidence, AAII, NAAIM, forward P/E, deal volume); those cards carry a STALE? flag if the release looks old. Unverifiable values display "Data unavailable" and are excluded from all percentages. Nothing is hardcoded or estimated. Thresholds are disclosed methodology printed on every card. The Japan Lens uses Japan MOF daily JGB yields, FRED (yen, US 10y) and CFTC Commitments of Traders (carry positioning); it is deliberately excluded from the Lens-2 froth % so that composite stays comparable to its historical peak bands — instead it acts as an override on the overall read: a red Japan reading forces a red banner, an amber one lifts a green banner to amber.
          <br />
          <strong style={{ color: C.mute }}>Educational use only — not financial advice.</strong> Lens-2 signals are indicative gauges of market-peak conditions, not precise timing tools. Indicators describe probabilities, not certainties; no single gauge times the market. Trading and investing carry a high level of risk; past performance is not indicative of future results.
        </div>
      </div>
    </div>
  );
}
