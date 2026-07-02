# TriLens — Deploy Guide (v2026:07:02-14:14)

Target: **https://surferyogi.github.io/trilens/**
Backend: **already live** — nothing to deploy on Supabase unless you edit it.

## What is already done (verified working today)
- Edge Function `trilens-data` deployed (version 2) to the **connex** project `pvqwpzbjremcyobnsldd`, `verify_jwt=false`.
- Table `public.trilens_cache` created there (RLS on, no policies — service-role only).
- End-to-end tested: all Tier-1 sources returning (FRED ×8, Yahoo ^GSPC/RPV/RPG, multpl ×2) and the AI block returning all 7 gap-fill series with current June/July-2026 releases.
- Uses the `ANTHROPIC_API_KEY` secret already set on connex (same one scan-card uses).

Test it yourself:
```
curl "https://pvqwpzbjremcyobnsldd.supabase.co/functions/v1/trilens-data"
```

## Local setup (place these files at ~/Downloads/trilens-app)
```
cd ~/Downloads/trilens-app
npm install
npm run dev        # local check at http://localhost:5173/trilens/
```

## First-time GitHub deploy
Create an empty repo named `trilens` under Surferyogi on github.com, then:
```
cd ~/Downloads/trilens-app
git init && git branch -M main
git remote add origin https://github.com/Surferyogi/trilens.git
git add -A && git commit -m "TriLens v2026:07:02-14:14 initial"
git push -u origin main
npm run deploy
```
Then GitHub → trilens → Settings → Pages: confirm source is the `gh-pages` branch.

## Subsequent deploys (standard workflow)
```
git add -A && git commit -m "msg" && git pull --no-rebase --no-edit && git push && npm run deploy
```

## If the Edge Function is edited later
```
supabase functions deploy trilens-data --no-verify-jwt --project-ref pvqwpzbjremcyobnsldd
```

## Refresh behaviour / cost control
- App load: served from server cache (deterministic block 6h TTL, AI block 24h TTL) — fast, near-zero cost.
- "FORCE FRESH READINGS" button: bypasses both caches (`?refresh=1&ai=1`); the AI block runs ~10 live web
  searches through your Anthropic key (~60s). Use deliberately, not habitually — the underlying series are
  weekly/monthly anyway.

## Data coverage map (truthful)
| Series | Tier | Source |
|---|---|---|
| Yield curve 10y−3m, Sahm, HY OAS, NFCI, UNRATE/PAYEMS, CPI YoY, SLOOS | LIVE API | FRED keyless CSV |
| S&P price + 50/150d SMA + slopes, RPV vs RPG 6m | LIVE API | Yahoo Finance (computed server-side) |
| Shiller CAPE, trailing P/E | LIVE API | multpl.com (HTML parse — flagged in `det.errors` if it breaks) |
| ISM PMI, Conf. Board LEI & Consumer Confidence, AAII, NAAIM, forward P/E, deal/IPO froth | AI SEARCH | Claude + live web search (no free API exists for these; each card shows its found source + period, with a STALE? flag) |
