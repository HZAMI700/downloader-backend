import { Router, Request, Response } from 'express';
import { getSystemHealth } from '../services/binaryChecker.service.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await getSystemHealth();
    const statusCode = health.status === 'error' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (err: unknown) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve system health',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
