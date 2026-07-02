// trilens-data v2026:07:02-14:14 — data backend for TriLens PWA
// ALREADY DEPLOYED (version 2) to Supabase project pvqwpzbjremcyobnsldd (connex) with --no-verify-jwt.
// This file is the canonical repo copy. Redeploy after edits with:
//   supabase functions deploy trilens-data --no-verify-jwt --project-ref pvqwpzbjremcyobnsldd
// v14:14 fix: date-aware AI prompt — first run returned a year-old ISM release; prompt now anchors to today's date,
// demands the most recent release, and self-reports staleness so nothing old masquerades as current.
// Tier 1: deterministic public APIs (FRED keyless CSV, Yahoo Finance, multpl scrape)
// Tier 2: Claude + live web search ONLY for series with no free API (ISM, LEI, CB Confidence, AAII, NAAIM, fwd P/E, deal froth)
// Tier 3: Supabase cache (det 6h / ai 24h). Anything unverifiable => null. Nothing estimated.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };
const DET_TTL_H = 6, AI_TTL_H = 24;

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

async function multpl(path: string, label: string) {
  const html = await (await fetch(`https://www.multpl.com/${path}`, { headers: UA })).text();
  const m = html.match(new RegExp(`${label}[^0-9]*([0-9.]+)`));
  if (!m) throw new Error(`multpl parse fail ${path}`);
  return parseFloat(m[1]);
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

  return new Response(JSON.stringify({ det, ai, meta: { det: detMeta, ai: aiMeta, version: "v2026:07:02-14:14" } }), {
    headers: { ...CORS, "content-type": "application/json" },
  });
});
