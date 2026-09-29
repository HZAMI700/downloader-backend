# Video Downloader Backend API

A high-performance, production-ready backend service designed for downloading YouTube (videos, shorts, audio) and Instagram (reels, posts) media using **yt-dlp**, **FFmpeg**, and **Deno** (for YouTube JavaScript challenge solving / yt-dlp-ejs).

---

## Architecture Overview

- **Runtime:** Node.js (v20+ / v22 / v24) + TypeScript + Express
- **Extractor:** `yt-dlp` (latest CLI)
- **Audio/Video Processor:** `FFmpeg` 8.x (for audio extraction and muxing separate video + audio DASH streams)
- **JS Challenge Solver:** `Deno` 2.x passed to yt-dlp via `--js-runtimes deno` and `--remote-components ejs:github`
- **Security:** Input validation, SSRF protection against private IP probing, Helmet headers, CORS policy
- **Lifecycle:** Automated file cleanup after streaming and periodic cleanup of stale files in `temp/`

---

## How yt-dlp, FFmpeg, and Deno Are Installed and Used

### 1. yt-dlp
`yt-dlp` is executed as a child process with security guards. It handles metadata extraction (`--dump-single-json`) and downloading.
- **Install (Linux/Docker):**
  ```bash
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
  ```
- **Install (Windows):** `winget install yt-dlp` or via Python `pip install yt-dlp`

### 2. FFmpeg
Used to mux separate high-definition video streams and audio streams into standard MP4 files, or transcode audio to 320kbps MP3.
- **Install (Ubuntu/Debian):** `sudo apt-get install -y ffmpeg`
- **Install (Windows):** `winget install Gyan.FFmpeg`
- Automatically detected by backend service and supplied to yt-dlp via `--ffmpeg-location`.

### 3. Deno & yt-dlp-ejs
YouTube frequently updates obfuscated JavaScript signature and "n-parameter" bot challenges. Modern `yt-dlp` offloads this computation to external JavaScript runtimes (`yt-dlp-ejs`).
- **Install (Linux/Docker):**
  ```bash
  curl -fsSL https://deno.land/install.sh | sh
  mv /root/.deno/bin/deno /usr/local/bin/deno
  ```
- **Install (Windows):** `winget install DenoLand.Deno`
- **Backend flags passed:** `--js-runtimes deno --remote-components ejs:github`

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Comprehensive health check returning availability & versions of yt-dlp, FFmpeg, Deno, and system resources. |
| `POST` | `/api/info` | Accepts `{ "url": "..." }`, validates URL, and returns video title, duration, author, thumbnail, and format options. |
| `GET` | `/api/download` | Query: `?url=...&format=1080p|720p|480p|360p|mp3&title=...`. Downloads, muxes/transcodes, streams directly to client as attachment, and cleans up temp file. |

---

## Environment Variables

Copy `.env.example` to `.env`:

```ini
PORT=5000
NODE_ENV=production
# Comma-separated list of allowed origins or * for all
ALLOWED_ORIGINS=https://downloader-frontend.vercel.app,http://localhost:3000

# Binary paths (leave blank if accessible in system PATH)
YTDLP_PATH=
FFMPEG_PATH=
DENO_PATH=

# Storage & timeouts
TEMP_DIR=./temp
MAX_DOWNLOAD_TIME_MS=600000
CLEANUP_INTERVAL_MS=900000
FILE_EXPIRATION_MS=1800000
```

---

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Start server
npm start

# For development with auto-reload:
npm run dev
```

---

## GoDaddy Deployment Assessment

Before attempting to deploy on GoDaddy, review the technical audit in `godaddy-analysis.md`:
- **GoDaddy Shared / cPanel / Free Hosting:** **Cannot run this backend** due to lack of root access, missing FFmpeg/Deno runtimes, strict 30-60s CloudLinux timeouts, and restrictions on spawning child processes.
- **GoDaddy VPS / Dedicated Server:** **Fully supported.** You can deploy using Docker or systemd.

### Docker Deployment on a VPS (GoDaddy VPS, DigitalOcean, Hetzner, AWS)

```bash
# Clone the repository
git clone https://github.com/HZAMI700/downloader-backend.git
cd downloader-backend

# Launch container
docker compose up -d --build

# Verify
curl http://localhost:5000/api/health
```
