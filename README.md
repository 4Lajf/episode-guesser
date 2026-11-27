# Episode Guesser

A SvelteKit anime episode screencap guessing game powered by **AniList**, **ani.zip** (TheTVDB episode screencaps), and **AnisongDB** (cached anime title autocomplete).

## Features

- **AniList integration with spoiler protection**: Load your public AniList (`Completed`, `Watching`, `Rewatching`, `Paused`, `Dropped`). Ongoing/paused/dropped shows are strictly capped to your watched episode progress so you never see frames from unwatched episodes.
- **Three game modes**:
  - **Classic**: 5 frames, max 5,000 points (500 pts for the anime + up to 500 pts scaled by episode proximity) with an episode timeline ruler and shareable recap.
  - **Unlimited**: Endless frames with live streak and personal best tracking.
  - **Daily Frame-Wordle**: 5 attempts on one daily puzzle (seeded by UTC date + your AniList or the Global Pool). Starts tightly cropped (`2.2×`) via server-side image cropping and pulls back each miss (`2.2× → 1.6× → 1.3× → 1.1× → 1.0×`) with Anime / Year ↑↓ / Episode ↑↓ feedback tiles and a spoiler-free share card.
- **Cached AnisongDB autocomplete**: Fetches `https://anisongdb.com/api/anime_name_autocomplete` with 24-hour in-memory + disk stale-while-revalidate caching.
- **Server-side integrity**: Round answers and upstream image URLs are sealed inside AES-256-GCM server tokens; Daily zoom crops are cut server-side with `sharp`, and Daily attempts are tracked per anonymous browser session via an `httpOnly` cookie + sealed state token persisted to `/app/.cache/daily-store.json` (clearing cookies starts a fresh anonymous session, as expected for a login-free game).

## Local Development

```bash
pnpm install
pnpm dev
```

Run checks, tests, and production build:

```bash
pnpm check
pnpm test
pnpm build
```

## Deploying on Coolify

1. Create a new **Application** in Coolify connected to this repository (`main` branch).
2. Set **Build Pack** to **Dockerfile** (exposed port `3000`, healthcheck `/api/health`).
3. Set **Domain** to `https://episode-guesser.karczma.moe`.
4. Add environment variables:
   - `SESSION_SECRET`: 32+ random hex characters (required so round/image tokens stay valid across restarts and redeploys)
   - `ORIGIN=https://episode-guesser.karczma.moe`
   - Client IP header for per-IP rate limiting:
     - If proxied through **Cloudflare** (e.g. orange-cloud DNS for `karczma.moe`): set `ADDRESS_HEADER=cf-connecting-ip`
     - If directly behind **Coolify Traefik** only: leave the default `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1` (or `XFF_DEPTH=2` for two proxy hops)
5. **Required persistent storage**: Mount a persistent volume at `/app/.cache` so both **Daily Wordle session progress** (`daily-store.json`) and the **cached AnisongDB title list** survive container redeploys.
