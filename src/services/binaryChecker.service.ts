import { spawn } from 'child_process';
import { config } from '../config.js';
import { BinaryManager } from './binaryManager.service.js';

export interface BinaryStatus {
  available: boolean;
  version: string | null;
  path: string;
  error?: string;
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'error';
  ytdlp: BinaryStatus;
  ffmpeg: BinaryStatus;
  deno: BinaryStatus;
  ytdlpEjsSupported: boolean;
  platform: string;
  nodeVersion: string;
  memoryUsageMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  uptimeSeconds: number;
  timestamp: string;
}

function runCommandOutput(command: string, args: string[], timeoutMs = 8000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let isSettled = false;

    const child = spawn(command, args, { shell: false });

    const timeout = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        resolve({ stdout, stderr: stderr + '\nCommand timed out', exitCode: -1 });
      }
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeout);
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      }
    });

    child.on('close', (code) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });
  });
}

export async function checkYtDlp(): Promise<BinaryStatus> {
  const binaries = BinaryManager.get();
  const binary = binaries.ytdlpPath || config.ytdlpPath || 'yt-dlp';
  try {
    const res = await runCommandOutput(binary, ['--version']);
    if (res.exitCode === 0 && res.stdout.trim()) {
      return {
        available: true,
        version: res.stdout.trim(),
        path: binary,
      };
    }
    return {
      available: false,
      version: null,
      path: binary,
      error: res.stderr.trim() || 'Command exited with non-zero code',
    };
  } catch (err: unknown) {
    return {
      available: false,
      version: null,
      path: binary,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkFfmpeg(): Promise<BinaryStatus> {
  const binaries = BinaryManager.get();
  const binary = binaries.ffmpegPath || config.ffmpegPath || 'ffmpeg';
  try {
    const res = await runCommandOutput(binary, ['-version']);
    if (res.exitCode === 0 && res.stdout.includes('ffmpeg version')) {
      const match = res.stdout.match(/ffmpeg version ([^\s]+)/);
      return {
        available: true,
        version: match ? match[1] : 'detected',
        path: binary,
      };
    }
    return {
      available: false,
      version: null,
      path: binary,
      error: res.stderr.trim() || 'FFmpeg not responding or not found',
    };
  } catch (err: unknown) {
    return {
      available: false,
      version: null,
      path: binary,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkDeno(): Promise<BinaryStatus> {
  const binaries = BinaryManager.get();
  const binary = binaries.denoPath || config.denoPath || 'deno';
  try {
    const res = await runCommandOutput(binary, ['--version']);
    if (res.exitCode === 0 && res.stdout.includes('deno')) {
      const match = res.stdout.match(/deno ([^\s]+)/);
      return {
        available: true,
        version: match ? match[1] : 'detected',
        path: binary,
      };
    }
    return {
      available: false,
      version: null,
      path: binary,
      error: res.stderr.trim() || 'Deno not found in PATH or not executable',
    };
  } catch (err: unknown) {
    return {
      available: false,
      version: null,
      path: binary,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [ytdlp, ffmpeg, deno] = await Promise.all([
    checkYtDlp(),
    checkFfmpeg(),
    checkDeno(),
  ]);

  const mem = process.memoryUsage();
  const ytdlpEjsSupported = ytdlp.available && deno.available;

  let status: 'ok' | 'degraded' | 'error' = 'ok';
  if (!ytdlp.available) {
    status = 'error';
  } else if (!ffmpeg.available || !deno.available) {
    status = 'degraded';
  }

  return {
    status,
    ytdlp,
    ffmpeg,
    deno,
    ytdlpEjsSupported,
    platform: process.platform,
    nodeVersion: process.version,
    memoryUsageMb: {
      rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
