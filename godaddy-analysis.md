# GoDaddy Hosting Technical Capability Assessment

## Executive Summary

Based on an exhaustive architectural audit of the video downloader backend requirements against GoDaddy hosting plans:

| Capability / Requirement | GoDaddy Free / Shared cPanel Hosting | GoDaddy VPS (Virtual Private Server) |
| :--- | :---: | :---: |
| **System Binaries (`yt-dlp`, `FFmpeg`, `Deno`)** | ❌ **Unsupported** (No root access, restricted `noexec` mounts) | ✅ **Supported** (Full root access to install any binary) |
| **Long-Running API / Download Processes** | ❌ **Unsupported** (Strict 30–60s CloudLinux LVE timeout kills processes) | ✅ **Supported** (Unlimited execution duration via systemd/Docker) |
| **Child Process Spawning (`child_process.spawn`)** | ❌ **Restricted / Blocked** (CageFS sandbox restricts execution) | ✅ **Supported** (Full process isolation & kernel access) |
| **Persistent Node.js Server Port Binding** | ❌ **Unsupported** (Uses Passenger reverse proxy; no raw port listening) | ✅ **Supported** (Any custom port, reverse proxy via Nginx/Caddy) |
| **CPU / RAM for Transcoding / Muxing** | ❌ **Exceeded** (Shared limits trigger account suspension/throttling) | ✅ **Supported** (Dedicated vCPU and RAM allocations) |
| **Deno External JavaScript Challenge Solver** | ❌ **Unsupported** (Cannot run Deno binary inside CageFS) | ✅ **Supported** (Deno runs natively in `/usr/local/bin`) |

---

## Detailed Technical Analysis: Why GoDaddy Shared/Free Hosting Cannot Run the Backend

### 1. Absence of Root/Sudo Access
GoDaddy Shared/cPanel hosting does not grant SSH root (`sudo`) privileges.
- `yt-dlp`, `ffmpeg`, and `ffprobe` require specific shared libraries (`glibc`, `libx264`, `libopus`, etc.) and system PATH registration.
- `Deno` is a compiled Rust binary requiring executable permissions, which cannot be installed into system paths like `/usr/local/bin` without root access.

### 2. CloudLinux OS LVE & CageFS Sandboxing
GoDaddy shared hosting operates on **CloudLinux OS** with **CageFS** and **LVE (Lightweight Virtual Environment)** manager:
- **NPROC Limit:** Enforces a hard limit on the number of concurrent child processes (typically 20–40 total). Spawning `yt-dlp`, which internally forks `deno` and pipes into `ffmpeg`, instantly saturates the process limit and gets killed with `EAGAIN` (Resource temporarily unavailable).
- **CPU & Memory Throttling:** Video downloading and muxing (especially 1080p video streams with audio) is CPU- and I/O-intensive. In shared hosting, exceeding resource spikes results in an immediate `508 Resource Limit Reached` HTTP error.
- **Process Lifetime Watchdog:** Any background process running longer than 60–120 seconds is automatically terminated by the hosting daemon.

### 3. Missing Binary Dependencies & `noexec` Partitions
- Shared hosting directories (`/home/username/public_html`, `/tmp`, etc.) are frequently mounted with the `noexec` flag for security. Users cannot upload pre-compiled Linux binaries of `deno` or `ffmpeg` into their home folder and execute them.

### 4. Reverse Proxy and Streaming Limitations
- The backend streams live video files using HTTP `Content-Disposition: attachment`. GoDaddy shared hosting operates behind an Apache/cPanel proxy that buffers large HTTP responses in memory and has strict request timeout limits, causing download drops for larger video files.

---

## The Production-Ready Solution: Deploying to a VPS (GoDaddy VPS or Alternative)

If you have or upgrade to a **GoDaddy VPS** (or any Linux VPS such as DigitalOcean, Hetzner, Linode, AWS EC2, or Railway):

### Method A: One-Command Docker Deployment (Recommended)
1. SSH into your VPS:
   ```bash
   ssh root@<YOUR_SERVER_IP>
   ```
2. Clone your repository:
   ```bash
   git clone https://github.com/HZAMI700/downloader-backend.git
   cd downloader-backend
   ```
3. Launch with Docker Compose:
   ```bash
   docker compose up -d --build
   ```
4. Test health:
   ```bash
   curl http://<YOUR_SERVER_IP>:5000/api/health
   ```

### Method B: Native Ubuntu/Debian Setup via systemd
1. Install system binaries:
   ```bash
   sudo apt-get update
   sudo apt-get install -y nodejs npm ffmpeg python3 curl unzip
   sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
   sudo chmod a+rx /usr/local/bin/yt-dlp
   curl -fsSL https://deno.land/install.sh | sh
   sudo mv /root/.deno/bin/deno /usr/local/bin/deno
   ```
2. Copy files to `/var/www/downloader-backend`, run `npm install && npm run build`.
3. Copy systemd service file:
   ```bash
   sudo cp backend.service /etc/systemd/system/downloader-backend.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now downloader-backend
   ```
4. Set up Nginx reverse proxy with SSL (`certbot --nginx -d api.yourdomain.com`).
5. Update `NEXT_PUBLIC_BACKEND_URL` on your Vercel frontend to point to `https://api.yourdomain.com`.
