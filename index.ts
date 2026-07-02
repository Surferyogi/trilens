// trilens-data v2026:07:02-15:51 — data backend for TriLens PWA
// DEPLOYED to Supabase project pvqwpzbjremcyobnsldd (connex), verify_jwt=false. Canonical repo copy.
// Redeploy after edits: supabase functions deploy trilens-data --no-verify-jwt --project-ref pvqwpzbjremcyobnsldd
//
// v15:51 adds ?chart=6m|1y|5y|all — S&P 500 daily history (Yahoo, from 1927 via epoch params;
//   range=max&interval=1d silently coerces to quarterly, so we use period1/period2) with server-computed
//   50d/150d SMAs and HONESTLY-SCOPED historical signal bands:
//   - lens1_sahm  : Sahm Rule >= 0.50 (FRED SAHMREALTIME, monthly, from 1959)   [Lens-1 PROXY, 1 of 7]
//   - lens1_curve : 10y-3m spread < 0 (FRED T10Y3M, daily, from 1982)           [Lens-1 PROXY, 1 of 7]
//   - lens3_break : 50d SMA < 150d SMA computed from the closes themselves
//   Lens 2 history is NOT reconstructible from free public data (AAII/NAAIM/CB/fwd-P/E composites) — omitted by design.
// v14:14: date-aware AI prompt with staleness self-report (fixed year-old ISM release defect).
// Tier 1: deterministic public APIs (FRED keyless CSV, Yahoo Finance, multpl scrape)
// Tier 2: Claude + live web search ONLY for series with no free API
// Tier 3: Supabase cache (det 6h / ai 24h / chart 6h). Anything unverifiable => null. Nothing estimated.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };
const DET_TTL_H = 6, AI_TTL_H = 24, CHART_TTL_H = 6;
const VERSION = "v2026:07:02-15:51";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function cacheGet(key: string, ttlH: number) {
  const { data } = await sb.from("trilens_cache").select("payload,fetched_at").eq("key", key).maybeSingle();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at).getTime()) / 3.6e6;
  return age <= ttlH ? { payload: data.payload, fetched_at: data.fetched_at, age_h: +age.toFixed(1) } : null;
}
async function cacheSet(key: string, payload: unknown) {
  await sb.from("trilens_cache").upsert({ key, payload, fetched_at: new Date().toISOString() });
}

// ---------- Tier 1 fetchers (each returns null on failure, never a guess) ----------
async function fredSeries(id: string): Promise<{ d: string; v: number }[]> {
  const t = await (await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`)).text();
  return t.trim().split("\n").slice(1).map((r) => r.split(","))
    .filter((r) => r.length === 2 && r[1] !== "." && r[1] !== "")
    .map(([d, v]) => ({ d, v: parseFloat(v) }))
    .filter((x) => isFinite(x.v));
}
const last = <T>(a: T[]) => a[a.length - 1];

async function yahooCloses(sym: string, range: string) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
  const j = await (await fetch(u, { headers: UA })).json();
  const res = j?.chart?.result?.[0];
  const closes: number[] = (res?.indicators?.quote?.[0]?.close || []).filter((x: number | null) => x != null && isFinite(x));
  if (!closes.length) throw new Error(`yahoo empty ${sym}`);
  return { closes, asOf: new Date((res.meta.regularMarketTime || 0) * 1000).toISOString().slice(0, 10) };
}
// Full daily history with dates. range=max&interval=1d silently downgrades to quarterly bars,
// so we request explicit epoch bounds (verified: returns daily from 1927-12-30).
async function yahooDailyFull(sym: string) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=-1400000000&period2=9999999999&interval=1d`;
  const j = await (await fetch(u, { headers: UA })).json();
  const res = j?.chart?.result?.[0];
  const ts: number[] = res?.timestamp || [];
  const cl: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
  const t: string[] = [], c: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = cl[i];
    if (v != null && isFinite(v)) { t.push(new Date(ts[i] * 1000).toISOString().slice(0, 10)); c.push(+v.toFixed(2)); }
  }
  if (!c.length) throw new Error(`yahoo empty ${sym}`);
  return { t, c };
}
const sma = (c: number[], n: number, endOffset = 0) => {
  const end = c.length - endOffset;
  if (end < n) return null;
  return c.slice(end - n, end).reduce((a, b) => a + b, 0) / n;
};
const slopeOf = (nowV: number | null, prevV: number | null) => {
  if (nowV == null || prevV == null) return null;
  const pct = (nowV / prevV - 1) * 100;
  return pct > 0.15 ? "rising" : pct < -0.15 ? "falling" : "flat";
};
function smaArray(c: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += c[i];
    if (i >= n) s -= c[i - n];
    if (i >= n - 1) out[i] = +(s / n).toFixed(1);
  }
  return out;
}
// contiguous true-runs -> intervals; merge small gaps, drop tiny runs (disclosed methodology, for legibility)
function intervals(dates: string[], flags: boolean[], mergeGap: number, minLen: number) {
  const raw: [number, number][] = [];
  let s = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && s < 0) s = i;
    if ((!flags[i] || i === flags.length - 1) && s >= 0) { raw.push([s, flags[i] ? i : i - 1]); s = -1; }
  }
  const merged: [number, number][] = [];
  for (const r of raw) {
    if (merged.length && r[0] - merged[merged.length - 1][1] <= mergeGap) merged[merged.length - 1][1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([a, b]) => b - a + 1 >= minLen).map(([a, b]) => ({ a: dates[a], b: dates[b] }));
}

async function buildDet() {
  const errors: string[] = [];
  const safe = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch (e) { errors.push(`${name}: ${(e as Error).message}`); return null; }
  };

  const [yc, sahm, hy, unr, pay, nfci, sloos, cpi] = await Promise.all([
    safe("T10Y3M", () => fredSeries("T10Y3M")),
    safe("SAHM", () => fredSeries("SAHMREALTIME")),
    safe("HYOAS", () => fredSeries("BAMLH0A0HYM2")),
    safe("UNRATE", () => fredSeries("UNRATE")),
    safe("PAYEMS", () => fredSeries("PAYEMS")),
    safe("NFCI", () => fredSeries("NFCI")),
    safe("SLOOS", () => fredSeries("DRTSCILM")),
    safe("CPI", () => fredSeries("CPIAUCSL")),
  ]);
  const [spx, rpv, rpg, cape, tpe] = await Promise.all([
    safe("GSPC", () => yahooCloses("^GSPC", "1y")),
    safe("RPV", () => yahooCloses("RPV", "6mo")),
    safe("RPG", () => yahooCloses("RPG", "6mo")),
    safe("CAPE", () => multpl("shiller-pe", "Current Shiller PE Ratio is")),
    safe("TPE", () => multpl("s-p-500-pe-ratio", "Current S&P 500 PE Ratio is")),
  ]);

  const pick = (s: { d: string; v: number }[] | null) => (s && s.length ? { v: last(s).v, d: last(s).d, src: "FRED" } : null);

  let labor = null;
  if (unr && unr.length >= 13) {
    const l12 = unr.slice(-12);
    const low = Math.min(...l12.map((x) => x.v));
    const payDelta = pay && pay.length >= 2 ? +(last(pay).v - pay[pay.length - 2].v).toFixed(0) : null;
    labor = { ur: last(unr).v, low, off_low: +(last(unr).v - low).toFixed(2), pay_k: payDelta, d: last(unr).d, src: "FRED (UNRATE, PAYEMS)" };
  }
  let cpiYoy = null;
  if (cpi && cpi.length >= 13) {
    cpiYoy = { v: +((last(cpi).v / cpi[cpi.length - 13].v - 1) * 100).toFixed(2), d: last(cpi).d, src: "FRED (CPIAUCSL, computed YoY)" };
  }
  let sloosOut = null;
  if (sloos && sloos.length >= 2) {
    const cur = last(sloos).v, prev = sloos[sloos.length - 2].v;
    sloosOut = { v: cur, prev, dir: cur > prev ? "rising" : cur < prev ? "falling" : "flat", d: last(sloos).d, src: "FRED (DRTSCILM)" };
  }
  let trend = null;
  if (spx) {
    const c = spx.closes;
    const s50 = sma(c, 50), s150 = sma(c, 150);
    trend = {
      px: +last(c).toFixed(2),
      s50: s50 != null ? +s50.toFixed(2) : null,
      s150: s150 != null ? +s150.toFixed(2) : null,
      sl50: slopeOf(s50, sma(c, 50, 10)),
      sl150: slopeOf(s150, sma(c, 150, 10)),
      d: spx.asOf, src: "Yahoo Finance ^GSPC daily, SMAs computed server-side",
    };
  }
  let vg = null;
  if (rpv && rpg) {
    const r = (x: { closes: number[] }) => +((last(x.closes) / x.closes[0] - 1) * 100).toFixed(2);
    const v6 = r(rpv), g6 = r(rpg);
    vg = { value_6m: v6, growth_6m: g6, lead: g6 > v6 ? "growth" : "value", d: rpv.asOf, src: "Yahoo Finance RPV vs RPG, 6-mo return computed" };
  }

  return {
    yc: pick(yc), sahm: pick(sahm), hy: pick(hy), nfci: pick(nfci),
    labor, cpi_yoy: cpiYoy, sloos: sloosOut, trend, vg,
    cape: cape != null ? { v: cape, d: "latest shown on multpl.com", src: "multpl.com (Shiller data)" } : null,
    tpe: tpe != null ? { v: tpe, d: "latest shown on multpl.com", src: "multpl.com" } : null,
    errors,
  };
}

async function multpl(path: string, label: string) {
  const html = await (await fetch(`https://www.multpl.com/${path}`, { headers: UA })).text();
  const m = html.match(new RegExp(`${label}[^0-9]*([0-9.]+)`));
  if (!m) throw new Error(`multpl parse fail ${path}`);
  return parseFloat(m[1]);
}

// ---------- chart: full daily history + honestly-scoped signal bands ----------
async function buildChartFull() {
  const errors: string[] = [];
  const { t, c } = await yahooDailyFull("^GSPC");
  const s50 = smaArray(c, 50);
  const s150 = smaArray(c, 150);
  // Lens 3: 50d below 150d (merge gaps <=10 trading days; drop runs <5 days — disclosed legibility smoothing)
  const death = intervals(t, c.map((_, i) => s50[i] != null && s150[i] != null && (s50[i] as number) < (s150[i] as number)), 10, 5);
  // Lens 1 proxies from FRED history
  let sahmBands: { a: string; b: string }[] = [], invBands: { a: string; b: string }[] = [];
  let sahmFrom: string | null = null, curveFrom: string | null = null;
  try {
    const sahm = await fredSeries("SAHMREALTIME");
    sahmFrom = sahm[0]?.d ?? null;
    sahmBands = intervals(sahm.map((x) => x.d), sahm.map((x) => x.v >= 0.5), 1, 1); // monthly series
  } catch (e) { errors.push(`SAHM hist: ${(e as Error).message}`); }
  try {
    const yc = await fredSeries("T10Y3M");
    curveFrom = yc[0]?.d ?? null;
    invBands = intervals(yc.map((x) => x.d), yc.map((x) => x.v < 0), 10, 5);
  } catch (e) { errors.push(`T10Y3M hist: ${(e as Error).message}`); }
  return {
    t, c, s50, s150,
    bands: { lens1_sahm: sahmBands, lens1_curve: invBands, lens3_break: death },
    coverage: { px_from: t[0], sahm_from: sahmFrom, curve_from: curveFrom },
    errors,
  };
}

function sliceChart(full: { t: string[]; c: number[]; s50: (number | null)[]; s150: (number | null)[]; bands: unknown; coverage: unknown; errors: string[] }, range: string) {
  const n = full.t.length;
  const spans: Record<string, { obs: number; step: number; sampled: string }> = {
    "6m": { obs: 128, step: 1, sampled: "daily" },
    "1y": { obs: 253, step: 1, sampled: "daily" },
    "5y": { obs: 1265, step: 5, sampled: "every 5th trading day" },
    "all": { obs: n, step: 21, sampled: "every 21st trading day (~monthly)" },
  };
  const sp = spans[range] || spans["1y"];
  const start = Math.max(0, n - sp.obs);
  const idx: number[] = [];
  for (let i = start; i < n; i += sp.step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1); // always include latest close
  return {
    t: idx.map((i) => full.t[i]),
    c: idx.map((i) => full.c[i]),
    s50: idx.map((i) => full.s50[i]),
    s150: idx.map((i) => full.s150[i]),
    bands: full.bands,
    coverage: full.coverage,
    sampled: sp.sampled,
    window_from: full.t[start],
    errors: full.errors,
  };
}

// ---------- Tier 2: Claude + web search for API-less series ----------
function aiPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `Today's date is ${today}. Search the web for the MOST RECENT officially published values of these US indicators. These are monthly/weekly series, so the latest release should normally be dated within the past 1-2 months of today. CRITICAL: search results often surface releases from previous years — verify the publication month AND year of every figure before reporting it, and keep searching until you find the newest release. STRICT RULES: report ONLY values you actually found in search results, with their true publication period and source name. If the newest release you can verify is more than 3 months old, still report it but set "stale":true for that item. If a value cannot be verified at all, set its v to null. NEVER estimate, interpolate, or recall from memory. Return ONLY the JSON object, no markdown, no commentary:
{"ism":{"v":<ISM Manufacturing PMI headline, latest monthly release>,"d":"<true as-of period incl. year>","src":"<source>","stale":<true|false>},
"lei":{"v":<Conference Board US LEI six-month percent change, as published>,"lvl":<index level or null>,"d":"","src":"","stale":false},
"cc":{"v":<Conference Board Consumer Confidence Index headline, latest monthly>,"d":"","src":"","stale":false},
"aaii":{"v":<AAII survey percent bullish, latest week>,"d":"","src":"","stale":false},
"naaim":{"v":<NAAIM Exposure Index latest reading>,"d":"","src":"","stale":false},
"fpe":{"v":<S&P 500 forward 12-month P/E>,"d":"","src":"","stale":false},
"deal":{"t":<true if current global/US M&A plus IPO issuance is at or near record/multi-year-high volume, false if clearly not, null if unverifiable>,"e":"<one-line evidence with period>","d":"","src":"","stale":false}}`;
}

async function buildAI() {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { error: "ANTHROPIC_API_KEY not set on this Supabase project" };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 1000,
      messages: [{ role: "user", content: aiPrompt() }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
    }),
  });
  const j = await r.json();
  if (j.error) return { error: j.error.message };
  const text = (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "no JSON in AI response" };
  try { return JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  // chart endpoint — independent of the gauges payload (surgical, no AI cost)
  const chartRange = url.searchParams.get("chart");
  if (chartRange) {
    let full, tier;
    const cc = url.searchParams.get("refresh") === "1" ? null : await cacheGet("chartfull", CHART_TTL_H);
    if (cc) { full = cc.payload; tier = { tier: "cache", fetched_at: cc.fetched_at, age_h: cc.age_h }; }
    else {
      try { full = await buildChartFull(); } catch (e) {
        return new Response(JSON.stringify({ error: `chart build failed: ${(e as Error).message}` }), { status: 502, headers: { ...CORS, "content-type": "application/json" } });
      }
      await cacheSet("chartfull", full);
      tier = { tier: "live", fetched_at: new Date().toISOString() };
    }
    return new Response(JSON.stringify({ chart: sliceChart(full, chartRange), meta: { chart: tier, version: VERSION } }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  const forceDet = url.searchParams.get("refresh") === "1";
  const forceAI = url.searchParams.get("ai") === "1";

  let det, detMeta;
  const dc = forceDet ? null : await cacheGet("det", DET_TTL_H);
  if (dc) { det = dc.payload; detMeta = { tier: "cache", fetched_at: dc.fetched_at, age_h: dc.age_h }; }
  else { det = await buildDet(); await cacheSet("det", det); detMeta = { tier: "live", fetched_at: new Date().toISOString() }; }

  let ai, aiMeta;
  const ac = forceAI ? null : await cacheGet("ai", AI_TTL_H);
  if (ac) { ai = ac.payload; aiMeta = { tier: "cache", fetched_at: ac.fetched_at, age_h: ac.age_h }; }
  else { ai = await buildAI(); await cacheSet("ai", ai); aiMeta = { tier: "live", fetched_at: new Date().toISOString() }; }

  return new Response(JSON.stringify({ det, ai, meta: { det: detMeta, ai: aiMeta, version: VERSION } }), {
    headers: { ...CORS, "content-type": "application/json" },
  });
});
