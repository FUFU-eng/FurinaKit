<div align="center">

# OmniKit

**A self-hosted, all-in-one web toolkit — image, PDF, and utility tools processed entirely in-browser, plus optional video/audio downloaders through a self-hosted Python worker.**

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-worker-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

[Live demo](https://omniikit.vercel.app/) · [Report a bug](https://github.com/Abudora-0/omnikit/issues)

*A full self-hosted deployment (all 43 tools, including downloaders) also runs on a personal VPS — not publicly linked here, but the setup below reproduces it exactly.*

</div>

---

## Overview

OmniKit bundles **43 tools** across image editing, PDF manipulation, text/data utilities, and media downloading into a single Next.js app with a polished, animated UI. Most tools run **entirely in memory or in the browser** — nothing is written to disk, nothing is uploaded to a third party — which makes them safe to deploy on serverless platforms like Vercel. A smaller set of heavier tools (video/audio downloaders, AI background removal) route through an optional self-hosted Python worker for users who want the full feature set on their own hardware.

| | |
|---|---|
| 🖼️ **Image tools** | Convert, resize, compress, crop, rotate, flip, grayscale, blur, watermark, strip metadata, adjust color, remove backgrounds, erase watermarks |
| 📄 **PDF tools** | Merge, split, rotate, delete/reorder pages, images→PDF, page numbers, watermark, extract text, PDF→images, compress, unlock, repair |
| 🧰 **Utilities** | QR codes, hashing, JSON formatting, URL/Base64 encoding, color conversion, JWT decoding, regex testing, Markdown preview |
| ⬇️ **Downloaders** *(self-host only)* | YouTube, Instagram, TikTok, Twitter/X, Reddit, Spotify, and generic MP3 extraction via `yt-dlp` / `spotdl` |

## Why it's built this way

- **Sync tools** (most image/PDF/utility tools) run inside a single API route — the file is read into memory, processed with Sharp/pdf-lib, and streamed straight back. No `data/storage`, no database, no persistent state.
- **Client-side tools** (JSON formatter, PDF→images, background remover, text utilities) run fully in your browser via WASM/JS — the file never leaves your machine.
- **Async tools** (downloaders, GPU background removal) enqueue a job that a Python worker picks up, processes with `yt-dlp`/`spotdl`/`rembg`, and reports progress back through polling. This path is gated behind an environment flag and requires self-hosting.

This split is what lets the same codebase deploy cleanly to Vercel (fast, free, zero-maintenance) *and* run as a full personal media toolkit on a home server or VPS.

## Tech stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Framer Motion, TanStack Query
- **Image/PDF processing:** Sharp, pdf-lib, pdfjs-dist
- **Worker:** Python, FastAPI, `yt-dlp`, `spotdl`, `rembg` (ONNX), ffmpeg
- **Queue:** Redis (or a file-based queue for Redis-free self-hosting)
- **Monorepo:** pnpm workspaces (`apps/web`, `packages/shared`, `services/worker`)

## Quick start

### Option A — Vercel (image/PDF/utility tools only)

The fastest way to try OmniKit. Downloaders and GPU background removal are unavailable here since Vercel has no persistent worker, but everything else works out of the box.

1. [Import this repo into Vercel](https://vercel.com/new)
2. Set **Root Directory** to `apps/web`
3. Leave `NEXT_PUBLIC_ENABLE_DOWNLOADS` **unset**
4. Set `MAX_FILE_SIZE_MB=4` (serverless body size cap)
5. Deploy — no database or worker required

### Option B — Docker (full stack, self-hosted)

Requires [Docker](https://www.docker.com/) and Docker Compose.

```bash
git clone https://github.com/Abudora-0/omnikit.git
cd omnikit
cp .env.example .env
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000). All 43 tools are available, including downloaders.

> **Low-RAM VPS (≈1GB)?** Set `NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS=0` in your `.env` before building — this hides the memory-hungry worker-side background remover while keeping the browser-only version and all downloaders working.

### Option C — Local dev (no Docker)

```bash
pnpm install
pnpm dev              # web app → http://localhost:3000

# in a second terminal, for downloaders/bg-remove:
cd services/worker
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
python worker.py
```

Downloaders work via a file-based queue (`USE_FILE_QUEUE=true`) so a Redis install isn't strictly required for local use — see [`.env.example`](.env.example).

## How to use the downloaders

Downloaders are self-host only, gated behind `NEXT_PUBLIC_ENABLE_DOWNLOADS=1`, and processed by the Python worker (`services/worker/`) using `yt-dlp` and `spotdl`.

1. **Enable the feature flag.** In Docker this is already set in `docker-compose.yml`; for local dev, set it in `apps/web/.env.local`.
2. **Pick a downloader tool** from the Downloads/Audio category — YouTube, Instagram, TikTok, Twitter/X, Reddit, Spotify, or generic MP3 extraction.
3. **Paste the URL**, choose a format/quality, and start the job. Progress streams live; the finished file downloads through your browser.
4. **ffmpeg** is required for merging video/audio streams and MP3 extraction. The Docker image includes it; for local/VPS installs, make sure `ffmpeg` is on `PATH` (`services/worker/app/ffmpeg.py` also auto-discovers common Windows install locations).

### Authenticating gated content (cookies)

Some platforms — most notably YouTube (bot/sign-in checks), Instagram (Reels/Stories), and age-restricted X/Twitter posts — require a logged-in session to download. Supply cookies to the worker:

1. Log into the platform(s) you need in your regular browser.
2. Export your cookies as a Netscape `cookies.txt` file using a browser extension (e.g. "Get cookies.txt LOCALLY"), using its **"export all cookies"** option so every domain's session is captured in one file — not just the current tab.
3. Place the file at `services/worker/cookies.txt` (already gitignored — never commit this file).
4. Set `COOKIES_FILE=/app/cookies.txt` (Docker) or the absolute local path (non-Docker) in the worker's `.env`.
5. Restart the worker.

**Notes:**
- YouTube in particular rotates session cookies automatically as a security measure, so exported cookies can stop working after a while — if downloads start failing again with a "sign in to confirm you're not a bot" error, just re-export and redeploy `cookies.txt`.
- yt-dlp needs a JS runtime (Deno, bundled in the Docker image) to solve YouTube's anti-bot "n challenge" — without it, only thumbnail/storyboard formats are returned.
- `COOKIES_FROM_BROWSER=<browser>` is also supported as an alternative to a cookies file, but only works when the worker runs on the same machine as that browser (not viable on a headless VPS).

### Refreshing cookies (when downloads start failing again)

This is a normal, recurring maintenance step — not a bug. Do this whenever a downloader that used to work suddenly fails with a sign-in/bot-check error.

**1. Re-export a fresh `cookies.txt`**
- Open your browser and make sure you're logged into the platform(s) you need (YouTube, Instagram, X, Reddit, etc.)
- Run your cookie-export extension's **"Export All Cookies"** option (not "current site only") so every domain lands in one file
- Save it, replacing the old file

**2. Deploy the fresh file to the worker**

*Local Docker Compose:*
```bash
cp path\to\new\cookies.txt services\worker\cookies.txt
docker compose restart worker
```

*Remote VPS (from your local machine):*
```powershell
scp -i "path\to\your-ssh-key" "path\to\new\cookies.txt" user@your-vps-ip:~/omnikit/services/worker/cookies.txt
```
then on the VPS:
```bash
docker compose restart worker
```

**3. Verify it worked**
```bash
docker exec omnikit-worker-1 python -m yt_dlp --cookies /app/cookies.txt --list-formats "https://www.youtube.com/watch?v=<any-video-id>"
```
If it lists real video/audio formats (not just `sb0`–`sb3` storyboard entries), the session is valid — retry the download from the UI.

### Legal disclaimer

Downloader tools are provided for **personal use only**. Downloading content from YouTube, Instagram, TikTok, Twitter/X, Reddit, or Spotify may violate those platforms' Terms of Service and/or applicable copyright law. You are solely responsible for how you use these features. Image and PDF tools process files locally/in-memory and carry no such third-party concerns.

## Architecture

```
User → Next.js (apps/web)
         ├── Sync tools   → API route → registry handler → Sharp / pdf-lib  (in memory, streamed back)
         ├── Client tools → run fully in the browser (JSON formatter, PDF→images, bg-remove, text utils)
         └── Async tools  → API route → Redis / file queue → Python worker (self-host only)
                                                              ↑
                                               services/worker/worker.py
```

- `apps/web` — Next.js frontend, sync-tool API routes, job orchestration
- `packages/shared` — shared tool definitions, Zod schemas, gating logic (zero dependency on Next.js)
- `services/worker` — Python FastAPI-adjacent polling worker for async jobs (`yt-dlp`, `spotdl`, `rembg`)

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_ENABLE_DOWNLOADS` | unset | Set to `1` to reveal downloader/worker tools (requires the worker) |
| `NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS` | `1` | Set to `0` to hide the memory-hungry GPU background remover (e.g. on a 1GB VPS) |
| `MAX_FILE_SIZE_MB` | `100` | Upload size limit (`4` on Vercel due to the serverless body cap) |
| `USE_FILE_QUEUE` | `false` | Use a local file-based queue instead of Redis |
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis connection (ignored when `USE_FILE_QUEUE=true`) |
| `STORAGE_DIR` / `STORAGE_PATH` | `./data/storage` | Where async job uploads/results are stored (self-host only) |
| `MAX_CONCURRENT_JOBS` | `2` | Worker concurrency |
| `JOB_TTL_HOURS` | `24` | How long job files are retained before cleanup |
| `COOKIES_FILE` | unset | Path to a Netscape `cookies.txt` for authenticated downloads |
| `COOKIES_FROM_BROWSER` | unset | Browser name to read cookies from directly (same-machine only) |

See [`.env.example`](.env.example) for the full annotated list.

## Project structure

```
omnikit/
├── apps/web/              Next.js frontend + sync-tool API routes
├── packages/shared/       Tool registry, types, gating logic
├── services/worker/       Python async worker (downloaders, bg-remove)
├── docker-compose.yml
└── .env.example
```

## Troubleshooting

- **Jobs stay pending** — make sure Redis is running (or `USE_FILE_QUEUE=true`) and the worker process is up.
- **YouTube download fails with a sign-in error** — your cookies have likely rotated; re-export and redeploy `cookies.txt`.
- **Video download fails with "requested format not available"** — make sure Deno (or another supported JS runtime) is installed for `yt-dlp`'s challenge solver.
- **Spotify download fails** — `spotdl` is fragile against Spotify's API changes; verify ffmpeg is installed and try a direct track URL.
- **Background removal is slow** — the first run downloads the ONNX model; later runs are faster.

## License

MIT
