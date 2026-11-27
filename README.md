# Episode Guesser

A SvelteKit anime episode screencap guessing game powered by **AniList**, **ani.zip** (TheTVDB episode screencaps), and **AnisongDB** (cached anime title autocomplete).

## Features

- **AniList integration with spoiler protection**: Load your public AniList (`Completed`, `Watching`, `Rewatching`, `Paused`, `Dropped`). Ongoing/paused/dropped shows are strictly capped to your watched episode progress so you never see frames from unwatched episodes.
- **Three game modes**:
  - **Classic**: 5 frames, max 5,000 points (500 pts for the anime + up to 500 pts scaled by episode proximity) with an episode timeline ruler and shareable recap.
  - **Unlimited**: Endless frames with live streak and personal best tracking.
  - **Daily Frame-Wordle**: 5 attempts on one daily puzzle (seeded by UTC date + your AniList or the Global Pool). Starts tightly cropped (`2.2×`) via server-side image cropping and pulls back each miss (`2.2× → 1.6× → 1.3× → 1.1× → 1.0×`) with Anime / Year ↑↓ / Episode ↑↓ feedback tiles and a spoiler-free share card.
- **Cached AnisongDB autocomplete**: Fetches `https://anisongdb.com/api/anime_name_autocomplete` with 24-hour in-memory + disk stale-while-revalidate caching.
- **Anti-cheat by design**: Round answers and upstream image URLs are sealed inside AES-256-GCM server tokens; Daily zoom crops are generated server-side with `sharp`, and Daily attempts are tracked per session via an `httpOnly` cookie + sealed state token on the server.

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

1. Create a new **Application** in Coolify connected to `4Lajf/episode-guesser` (`main` branch).
2. Set **Build Pack** to **Dockerfile** (exposed port `3000`, healthcheck `/api/health`).
3. Set **Domain** to `https://episode-guesser.karczma.moe`.
4. Add environment variables:
   - `SESSION_SECRET`: 32+ random hex characters (required so round/image tokens stay valid across restarts and redeploys)
   - `ORIGIN=https://episode-guesser.karczma.moe`
5. *(Optional)* Mount a persistent volume at `/app/.cache` to keep the cached AnisongDB autocomplete list across container restarts.
