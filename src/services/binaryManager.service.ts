import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync, spawn } from 'child_process';
import { logger } from '../utils/logger.js';

export interface ResolvedBinaries {
  ytdlpPath: string;
  ffmpegPath?: string;
  ffmpegDir?: string;
  denoPath?: string;
  binDir: string;
}

const BIN_DIR = path.resolve(process.cwd(), 'bin');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      logger.warn(`Could not create directory ${dir}:`, err);
    }
  }
}

function downloadFile(url: string, dest: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error(`Too many redirects downloading ${url}`));
    }

    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return downloadFile(res.headers.location, dest, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });

    req.setTimeout(60000, () => {
      req.destroy();
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(new Error(`Download timed out: ${url}`));
    });
  });
}

function isExecutableInPath(cmd: string): string | null {
  try {
    const checkCmd = process.platform === 'win32' ? `where.exe ${cmd}` : `which ${cmd}`;
    const output = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const firstLine = output.trim().split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {}
  return null;
}

export class BinaryManager {
  private static resolved: ResolvedBinaries | null = null;

  public static async init(): Promise<ResolvedBinaries> {
    if (this.resolved) return this.resolved;

    ensureDir(BIN_DIR);

    // 1. Resolve FFmpeg
    let ffmpegPath = isExecutableInPath('ffmpeg') || undefined;
    let ffmpegDir = ffmpegPath ? path.dirname(ffmpegPath) : undefined;

    if (!ffmpegPath) {
      try {
        // Try @ffmpeg-installer/ffmpeg
        // @ts-ignore
        const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
        const installerPath = ffmpegInstaller.default?.path || ffmpegInstaller.path;
        if (installerPath && fs.existsSync(installerPath)) {
          ffmpegPath = installerPath;
          ffmpegDir = path.dirname(installerPath);
          logger.info(`Resolved FFmpeg via @ffmpeg-installer: ${ffmpegPath}`);
        }
      } catch (e) {
        logger.debug('Could not load @ffmpeg-installer/ffmpeg:', e);
      }
    }

    // 2. Resolve yt-dlp
    let ytdlpPath = isExecutableInPath('yt-dlp') || 'yt-dlp';
    const localYtdlp = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

    if (ytdlpPath === 'yt-dlp' && fs.existsSync(localYtdlp)) {
      ytdlpPath = localYtdlp;
    } else if (ytdlpPath === 'yt-dlp' && process.platform === 'linux') {
      // Auto-download standalone yt-dlp Linux binary if missing
      logger.info('yt-dlp not found in system PATH. Attempting automatic standalone download to ./bin/yt-dlp...');
      try {
        const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
        await downloadFile(downloadUrl, localYtdlp);
        fs.chmodSync(localYtdlp, 0o755);
        ytdlpPath = localYtdlp;
        logger.info(`Successfully downloaded standalone yt-dlp to: ${localYtdlp}`);
      } catch (dlErr) {
        logger.warn('Failed to auto-download standalone yt-dlp:', dlErr);
      }
    }

    // 3. Resolve Deno
    let denoPath = isExecutableInPath('deno') || undefined;
    const localDeno = path.join(BIN_DIR, process.platform === 'win32' ? 'deno.exe' : 'deno');

    if (!denoPath && fs.existsSync(localDeno)) {
      denoPath = localDeno;
    } else if (!denoPath && process.platform === 'linux') {
      logger.info('Deno not found in system PATH. Checking if standalone binary can be installed...');
      try {
        const zipPath = path.join(BIN_DIR, 'deno.zip');
        const denoUrl = 'https://github.com/denoland/deno/releases/download/v2.2.3/deno-x86_64-unknown-linux-gnu.zip';
        await downloadFile(denoUrl, zipPath);
        // Unzip deno
        execSync(`unzip -o "${zipPath}" -d "${BIN_DIR}"`, { stdio: 'ignore' });
        try { fs.unlinkSync(zipPath); } catch {}
        if (fs.existsSync(localDeno)) {
          fs.chmodSync(localDeno, 0o755);
          denoPath = localDeno;
          logger.info(`Successfully downloaded standalone Deno to: ${localDeno}`);
        }
      } catch (denoErr) {
        logger.warn('Failed to auto-download standalone Deno:', denoErr);
      }
    }

    this.resolved = {
      ytdlpPath,
      ffmpegPath,
      ffmpegDir,
      denoPath,
      binDir: BIN_DIR,
    };

    return this.resolved;
  }

  public static get(): ResolvedBinaries {
    if (!this.resolved) {
      return {
        ytdlpPath: 'yt-dlp',
        binDir: BIN_DIR,
      };
    }
    return this.resolved;
  }
}
