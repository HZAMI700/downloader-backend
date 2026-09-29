import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class CleanupService {
  private static intervalHandle: NodeJS.Timeout | null = null;

  public static init(): void {
    if (!fs.existsSync(config.tempDir)) {
      fs.mkdirSync(config.tempDir, { recursive: true });
    }

    // Run initial cleanup
    this.sweepOldFiles();

    // Start interval
    this.intervalHandle = setInterval(() => {
      this.sweepOldFiles();
    }, config.cleanupIntervalMs);

    logger.info(`Cleanup service started. Sweep interval: ${config.cleanupIntervalMs / 1000}s, file expiration: ${config.fileExpirationMs / 1000}s`);
  }

  public static stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  public static sweepOldFiles(): void {
    try {
      if (!fs.existsSync(config.tempDir)) return;

      const now = Date.now();
      const files = fs.readdirSync(config.tempDir);
      let removedCount = 0;

      for (const file of files) {
        const fullPath = path.join(config.tempDir, file);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > config.fileExpirationMs) {
            fs.unlinkSync(fullPath);
            removedCount++;
          }
        } catch {
          // Ignore individual file error
        }
      }

      if (removedCount > 0) {
        logger.info(`Cleaned up ${removedCount} stale temporary download file(s).`);
      }
    } catch (err) {
      logger.error('Error during sweepOldFiles:', err);
    }
  }
}
