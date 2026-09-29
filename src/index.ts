import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './routes/health.routes.js';
import { mediaRouter } from './routes/media.routes.js';
import { CleanupService } from './services/cleanup.service.js';
import { getSystemHealth } from './services/binaryChecker.service.js';

const app = express();

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);

    if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Also match any vercel.app preview domain if allowedOrigins has vercel.app
    const isVercelAllowed = config.allowedOrigins.some(
      (allowed) => allowed.includes('vercel.app') && origin.endsWith('.vercel.app')
    );
    if (isVercelAllowed) {
      return callback(null, true);
    }

    logger.warn(`Blocked by CORS: origin ${origin}`);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Range'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Root welcome route
app.get('/', async (_req: Request, res: Response) => {
  res.json({
    name: 'Video Downloader Backend API',
    status: 'online',
    version: '1.0.0',
    documentation: {
      health: 'GET /api/health',
      extractInfo: 'POST /api/info (body: { url: string })',
      download: 'GET /api/download?url=...&format=1080p|720p|480p|360p|mp3',
    },
    technologies: ['yt-dlp', 'FFmpeg', 'Deno', 'yt-dlp-ejs'],
  });
});

// Mount API routes
app.use('/api', healthRouter);
app.use('/api', mediaRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// Initialize cleanup service
CleanupService.init();

// Start HTTP server
const server = app.listen(config.port, async () => {
  logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
  
  // Perform startup health check log
  try {
    const health = await getSystemHealth();
    logger.info(`System Status: ${health.status.toUpperCase()}`);
    logger.info(`  yt-dlp: ${health.ytdlp.available ? `✓ ${health.ytdlp.version}` : '✗ Missing'}`);
    logger.info(`  FFmpeg: ${health.ffmpeg.available ? `✓ ${health.ffmpeg.version}` : '✗ Missing'}`);
    logger.info(`  Deno:   ${health.deno.available ? `✓ ${health.deno.version}` : '✗ Missing'}`);
    logger.info(`  yt-dlp-ejs (YouTube Challenge Solver): ${health.ytdlpEjsSupported ? '✓ Active' : '✗ Inactive'}`);
  } catch (err) {
    logger.warn('Initial health check failed:', err);
  }
});

// Graceful shutdown
const handleShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  CleanupService.stop();
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export default app;
