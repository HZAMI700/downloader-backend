import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { sanitizeFilename } from '../utils/validator.js';
import { BinaryManager } from './binaryManager.service.js';

export interface VideoFormatOption {
  formatId: string;
  label: string;
  extension: 'mp4' | 'mp3';
  type: 'video' | 'audio';
  resolution?: string;
  filesizeApproxMb?: number;
  qualityNote?: string;
}

export interface VideoMetadata {
  id: string;
  title: string;
  thumbnail: string;
  durationSeconds: number;
  durationFormatted: string;
  uploader: string;
  platform: 'youtube' | 'instagram';
  originalUrl: string;
  formats: VideoFormatOption[];
  viewCount?: number;
}

export interface DownloadTaskResult {
  filePath: string;
  fileName: string;
  mimeType: string;
  cleanup: () => Promise<void>;
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export class YtDlpService {
  /**
   * Builds the base arguments for yt-dlp execution, adding Deno and FFmpeg paths
   */
  private static getBaseArgs(): string[] {
    const args: string[] = [];
    const binaries = BinaryManager.get();

    // Ensure yt-dlp knows where FFmpeg is
    const ffmpegTarget = binaries.ffmpegDir || binaries.ffmpegPath || config.ffmpegDir || config.ffmpegPath;
    if (ffmpegTarget) {
      args.push('--ffmpeg-location', ffmpegTarget);
    }

    // Enable Deno as JavaScript runtime for solving YouTube EJS challenges
    const denoTarget = binaries.denoPath || config.denoPath;
    if (denoTarget) {
      args.push('--js-runtimes', `deno:${denoTarget}`);
    } else {
      args.push('--js-runtimes', 'deno');
    }

    // Allow fetching remote components for EJS scripts when needed
    args.push('--remote-components', 'ejs:github');

    // Optional cookies
    if (config.cookiesFile && fs.existsSync(config.cookiesFile)) {
      args.push('--cookies', config.cookiesFile);
    }

    // Common standard flags
    args.push('--no-warnings');
    args.push('--no-playlist');
    args.push('--prefer-free-formats');
    args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    return args;
  }

  private static getYtdlpExecutable(): string {
    const binaries = BinaryManager.get();
    return binaries.ytdlpPath || config.ytdlpPath || 'yt-dlp';
  }

  /**
   * Extracts video info without downloading
   */
  public static async getVideoInfo(url: string, platform: 'youtube' | 'instagram'): Promise<VideoMetadata> {
    const executable = this.getYtdlpExecutable();
    const args = [
      ...this.getBaseArgs(),
      '--dump-single-json',
      '--skip-download',
      url,
    ];

    logger.info(`Extracting info using ${executable} for URL: ${url} (platform: ${platform})`);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isSettled = false;

      const child = spawn(executable, args, { shell: false });

      // Max timeout for extraction (45 seconds)
      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          reject(new Error('Extraction timed out after 45 seconds'));
        }
      }, 45000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          reject(new Error(`Failed to spawn yt-dlp (${executable}): ${err.message}`));
        }
      });

      child.on('close', (code) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);

          if (code !== 0) {
            logger.error(`yt-dlp extraction failed with code ${code}: ${stderr}`);
            if (stderr.includes('Private video') || stderr.includes('Sign in')) {
              return reject(new Error('This video is private, age-restricted, or requires login.'));
            }
            if (stderr.includes('Video unavailable')) {
              return reject(new Error('This video is unavailable or has been removed.'));
            }
            if (stderr.includes('Instagram') && stderr.includes('login')) {
              return reject(new Error('This Instagram post or reel requires login or is from a private profile.'));
            }
            return reject(new Error(stderr.trim().split('\n').pop() || 'Extraction failed'));
          }

          try {
            const raw = JSON.parse(stdout);
            const metadata = this.parseRawMetadata(raw, platform, url);
            resolve(metadata);
          } catch (parseErr) {
            logger.error(`JSON parse error from yt-dlp output: ${parseErr}`);
            reject(new Error('Failed to parse video metadata from extractor'));
          }
        }
      });
    });
  }

  private static parseRawMetadata(raw: any, platform: 'youtube' | 'instagram', originalUrl: string): VideoMetadata {
    const duration = raw.duration || 0;
    const title = raw.title || (platform === 'instagram' ? 'Instagram Reel/Post' : 'Video');
    const uploader = raw.uploader || raw.channel || raw.uploader_id || 'Unknown Creator';
    const thumbnail = raw.thumbnail || (raw.thumbnails && raw.thumbnails.length ? raw.thumbnails[raw.thumbnails.length - 1].url : '');

    const formats: VideoFormatOption[] = [];

    if (platform === 'youtube') {
      const availableHeights = new Set<number>();
      if (Array.isArray(raw.formats)) {
        for (const f of raw.formats) {
          if (f.height && typeof f.height === 'number') {
            availableHeights.add(f.height);
          }
        }
      }

      if (availableHeights.has(1080) || availableHeights.size === 0 || Math.max(...Array.from(availableHeights), 0) >= 1080) {
        formats.push({
          formatId: '1080p',
          label: '1080p Full HD',
          extension: 'mp4',
          type: 'video',
          resolution: '1920x1080',
          qualityNote: 'Best video + audio merged via FFmpeg',
        });
      }

      if (availableHeights.has(720) || availableHeights.size === 0 || Math.max(...Array.from(availableHeights), 0) >= 720) {
        formats.push({
          formatId: '720p',
          label: '720p HD',
          extension: 'mp4',
          type: 'video',
          resolution: '1280x720',
          qualityNote: 'High Definition MP4',
        });
      }

      if (availableHeights.has(480) || availableHeights.size === 0 || Math.max(...Array.from(availableHeights), 0) >= 480) {
        formats.push({
          formatId: '480p',
          label: '480p SD',
          extension: 'mp4',
          type: 'video',
          resolution: '854x480',
          qualityNote: 'Standard Definition MP4',
        });
      }

      formats.push({
        formatId: '360p',
        label: '360p Low',
        extension: 'mp4',
        type: 'video',
        resolution: '640x360',
        qualityNote: 'Data saver MP4',
      });

      formats.push({
        formatId: 'mp3',
        label: 'MP3 Audio Only',
        extension: 'mp3',
        type: 'audio',
        qualityNote: 'High Quality 320kbps MP3 extracted via FFmpeg',
      });
    } else {
      formats.push({
        formatId: 'best',
        label: 'Highest Quality Video',
        extension: 'mp4',
        type: 'video',
        qualityNote: 'Original HD MP4',
      });
      formats.push({
        formatId: 'mp3',
        label: 'Audio Only (MP3)',
        extension: 'mp3',
        type: 'audio',
        qualityNote: 'Audio track extracted via FFmpeg',
      });
    }

    return {
      id: raw.id || uuidv4(),
      title,
      thumbnail,
      durationSeconds: duration,
      durationFormatted: formatDuration(duration),
      uploader,
      platform,
      originalUrl,
      formats,
      viewCount: raw.view_count,
    };
  }

  /**
   * Downloads the video or audio to a unique temp file and returns file path and cleanup handler
   */
  public static downloadMedia(
    url: string,
    formatId: string,
    onProgress?: (progressPercent: number, text: string) => void,
    abortSignal?: AbortSignal
  ): Promise<DownloadTaskResult> {
    return new Promise((resolve, reject) => {
      const uniqueId = uuidv4().substring(0, 8);
      const isAudio = formatId === 'mp3' || formatId === 'audio';
      const outputTemplate = path.join(config.tempDir, `download_${uniqueId}_%(title).50s.%(ext)s`);

      const executable = this.getYtdlpExecutable();
      const args = [...this.getBaseArgs()];

      if (isAudio) {
        args.push(
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '0',
          '-o', outputTemplate,
          url
        );
      } else {
        let formatSelector = 'bestvideo+bestaudio/best';
        if (formatId === '1080p') {
          formatSelector = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
        } else if (formatId === '720p') {
          formatSelector = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
        } else if (formatId === '480p') {
          formatSelector = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
        } else if (formatId === '360p') {
          formatSelector = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
        }

        args.push(
          '-f', formatSelector,
          '--merge-output-format', 'mp4',
          '-o', outputTemplate,
          url
        );
      }

      logger.info(`Starting download with ${executable}: format=${formatId}, URL=${url}`);

      const child = spawn(executable, args, { shell: false });
      let isSettled = false;
      let stderr = '';

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          if (!isSettled) {
            isSettled = true;
            logger.warn(`Download aborted by client: ${url}`);
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
            reject(new Error('Download cancelled by user'));
          }
        });
      }

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          logger.warn(`Download timed out: ${url}`);
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          reject(new Error(`Download exceeded maximum limit of ${config.maxDownloadTimeMs / 1000}s`));
        }
      }, config.maxDownloadTimeMs);

      child.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        const match = str.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (match && onProgress) {
          const percent = parseFloat(match[1]);
          onProgress(percent, str.trim());
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          reject(new Error(`Download spawn error (${executable}): ${err.message}`));
        }
      });

      child.on('close', async (code) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);

          if (code !== 0) {
            logger.error(`yt-dlp download failed with code ${code}: ${stderr}`);
            return reject(new Error(stderr.trim().split('\n').pop() || 'Download failed in yt-dlp'));
          }

          try {
            const files = fs.readdirSync(config.tempDir);
            const targetFile = files.find((f) => f.startsWith(`download_${uniqueId}`));

            if (!targetFile) {
              return reject(new Error('Downloaded file was not found on disk'));
            }

            const fullPath = path.join(config.tempDir, targetFile);
            const cleanTitle = targetFile.replace(`download_${uniqueId}_`, '');
            const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';

            const cleanup = async () => {
              try {
                if (fs.existsSync(fullPath)) {
                  fs.unlinkSync(fullPath);
                  logger.debug(`Cleaned up temp file: ${fullPath}`);
                }
              } catch (cleanupErr) {
                logger.warn(`Failed to cleanup temp file ${fullPath}:`, cleanupErr);
              }
            };

            resolve({
              filePath: fullPath,
              fileName: cleanTitle,
              mimeType,
              cleanup,
            });
          } catch (findErr) {
            reject(findErr);
          }
        }
      });
    });
  }
}
