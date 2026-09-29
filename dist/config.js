import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
dotenv.config();
/**
 * Attempts to locate the binary or returns fallback
 */
function resolveBinary(cmd) {
    // Check env first
    const envVar = process.env[`${cmd.toUpperCase().replace('-', '')}_PATH`];
    if (envVar && fs.existsSync(envVar)) {
        const isDir = fs.statSync(envVar).isDirectory();
        return {
            path: isDir ? undefined : envVar,
            dir: isDir ? envVar : path.dirname(envVar),
        };
    }
    // Try finding via `where` on Windows or `which` on Unix
    try {
        const checkCmd = process.platform === 'win32' ? `where.exe ${cmd}` : `which ${cmd}`;
        const output = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const firstLine = output.trim().split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) {
            return {
                path: firstLine,
                dir: path.dirname(firstLine),
            };
        }
    }
    catch {
        // ignore
    }
    return {};
}
const tempDirectory = path.resolve(process.env.TEMP_DIR || './temp');
if (!fs.existsSync(tempDirectory)) {
    try {
        fs.mkdirSync(tempDirectory, { recursive: true });
    }
    catch (err) {
        console.error(`Failed to create temp directory at ${tempDirectory}:`, err);
    }
}
const rawOrigins = process.env.ALLOWED_ORIGINS || '*';
const allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);
const ffmpegResolved = resolveBinary('ffmpeg');
const denoResolved = resolveBinary('deno');
const ytdlpResolved = resolveBinary('yt-dlp');
export const config = {
    port: parseInt(process.env.PORT || '5000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ['*'],
    ytdlpPath: ytdlpResolved.path || process.env.YTDLP_PATH || 'yt-dlp',
    ffmpegPath: ffmpegResolved.path || process.env.FFMPEG_PATH,
    ffmpegDir: ffmpegResolved.dir,
    denoPath: denoResolved.path || process.env.DENO_PATH,
    tempDir: tempDirectory,
    maxDownloadTimeMs: parseInt(process.env.MAX_DOWNLOAD_TIME_MS || '600000', 10), // 10 minutes
    cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || '900000', 10), // 15 minutes
    fileExpirationMs: parseInt(process.env.FILE_EXPIRATION_MS || '1800000', 10), // 30 minutes
    cookiesFile: process.env.COOKIES_FILE ? path.resolve(process.env.COOKIES_FILE) : undefined,
};
