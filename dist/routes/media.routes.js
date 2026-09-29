import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { validateMediaUrl, sanitizeFilename } from '../utils/validator.js';
import { YtDlpService } from '../services/ytdlp.service.js';
import { logger } from '../utils/logger.js';
export const mediaRouter = Router();
const InfoRequestSchema = z.object({
    url: z.string().min(1, 'URL is required').max(2048, 'URL is too long'),
});
/**
 * POST /api/info
 * Extracts video title, thumbnail, duration, author, and available quality formats
 */
mediaRouter.post('/info', async (req, res) => {
    try {
        const parseResult = InfoRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: parseResult.error.errors[0]?.message || 'Invalid request body',
            });
            return;
        }
        const { url } = parseResult.data;
        const validation = validateMediaUrl(url);
        if (!validation.valid || !validation.cleanUrl || !validation.platform) {
            res.status(400).json({
                success: false,
                error: validation.error || 'Invalid video URL provided',
            });
            return;
        }
        const metadata = await YtDlpService.getVideoInfo(validation.cleanUrl, validation.platform);
        res.json({
            success: true,
            data: metadata,
        });
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Error in /api/info: ${errorMsg}`);
        res.status(500).json({
            success: false,
            error: errorMsg || 'Failed to extract video information',
        });
    }
});
const DownloadQuerySchema = z.object({
    url: z.string().min(1, 'URL is required'),
    format: z.string().default('best'),
    title: z.string().optional(),
});
/**
 * GET /api/download
 * Downloads the video/audio and streams it directly to client as attachment
 */
mediaRouter.get('/download', async (req, res) => {
    try {
        const parseResult = DownloadQuerySchema.safeParse(req.query);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: parseResult.error.errors[0]?.message || 'Invalid query parameters',
            });
            return;
        }
        const { url, format, title } = parseResult.data;
        const validation = validateMediaUrl(url);
        if (!validation.valid || !validation.cleanUrl) {
            res.status(400).json({
                success: false,
                error: validation.error || 'Invalid video URL',
            });
            return;
        }
        // Abort controller linked to client connection
        const abortController = new AbortController();
        req.on('close', () => {
            if (!res.writableEnded) {
                logger.info(`Client closed connection before completion: ${validation.cleanUrl}`);
                abortController.abort();
            }
        });
        const downloadResult = await YtDlpService.downloadMedia(validation.cleanUrl, format, (progress, text) => {
            logger.debug(`Download progress (${format}): ${progress}%`);
        }, abortController.signal);
        const stats = fs.statSync(downloadResult.filePath);
        const safeTitle = sanitizeFilename(title || downloadResult.fileName);
        const ext = downloadResult.mimeType === 'audio/mpeg' ? 'mp3' : 'mp4';
        const finalFilename = safeTitle.endsWith(`.${ext}`) ? safeTitle : `${safeTitle}.${ext}`;
        res.setHeader('Content-Type', downloadResult.mimeType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalFilename)}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`);
        const readStream = fs.createReadStream(downloadResult.filePath);
        readStream.on('error', async (streamErr) => {
            logger.error('Stream read error:', streamErr);
            await downloadResult.cleanup();
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Failed to read media stream' });
            }
        });
        res.on('finish', async () => {
            logger.info(`Download completed and delivered: ${finalFilename}`);
            await downloadResult.cleanup();
        });
        res.on('close', async () => {
            await downloadResult.cleanup();
        });
        readStream.pipe(res);
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Error in /api/download: ${errorMsg}`);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: errorMsg || 'Failed to download media',
            });
        }
    }
});
