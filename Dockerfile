# Production Dockerfile for Video Downloader Backend
# Provides Node.js + Python 3 + yt-dlp + FFmpeg + Deno (EJS challenge solver)

FROM node:22-bookworm-slim

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=5000
ENV DENO_INSTALL=/usr/local

WORKDIR /app

# Install system dependencies: Python 3, FFmpeg, curl, unzip, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Install Deno (required by yt-dlp for YouTube JavaScript challenge solving / yt-dlp-ejs)
RUN curl -fsSL https://deno.land/install.sh | sh -s -- -y \
    && mv /root/.deno/bin/deno /usr/local/bin/deno \
    && rm -rf /root/.deno

# Verify all required binaries are installed and accessible
RUN yt-dlp --version \
    && ffmpeg -version | head -n 1 \
    && deno --version

# Copy package files and install dependencies
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source code and build TypeScript
COPY src/ ./src/
RUN npm run build

# Clean up dev dependencies to keep image slim
RUN npm prune --production

# Create temp directory
RUN mkdir -p /app/temp && chmod 777 /app/temp

EXPOSE 5000

CMD ["node", "dist/index.js"]
