import express, { Request, Response } from 'express';
import { QueueClient } from '../lib/QueueClient';
import { SYSTEM_JOB_TYPES } from '../types';
import { AppConfig } from '../config';

const app = express();
app.use(express.json());

const queue = new QueueClient();

/**
 * POST /api/enqueue
 * Submit a generic job to the queue
 * Body: { type: string, payload: any, maxRetries?: number }
 * Headers: { 'idempotency-key': string } (Optional)
 */
app.post('/api/enqueue', async (req: Request, res: Response) => {
  const { type, payload, maxRetries } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!type || payload === undefined) {
    res.status(400).json({ error: 'Missing required fields: type and payload' });
    return;
  }

  try {
    const job = await queue.enqueue(type, payload, { maxRetries, idempotencyKey });
    res.status(201).json({
      success: true,
      jobId: job.id,
      type: job.type,
      status: job.status,
      idempotencyKey // Return key to confirm it was used
    });
  } catch (error: any) {
    console.error('[API] Enqueue error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/webhook
 * Shortcut endpoint for submitting remote HTTP jobs
 * Body: { url: string, method?: string, headers?: object, body?: any, timeout?: number }
 * Headers: { 'idempotency-key': string } (Optional)
 */
app.post('/api/webhook', async (req: Request, res: Response) => {
  const { url, method = 'POST', headers, body, timeout } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!url) {
    res.status(400).json({ error: 'Missing required field: url' });
    return;
  }

  try {
    const job = await queue.enqueue(SYSTEM_JOB_TYPES.WEBHOOK, {
      url,
      method,
      headers,
      body,
      timeout
    }, { idempotencyKey });
    
    res.status(201).json({
      success: true,
      jobId: job.id,
      type: job.type,
      status: job.status,
      idempotencyKey
    });
  } catch (error: any) {
    console.error('[API] Webhook enqueue error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/jobs/:id
 * Get job status and details
 */
app.get('/api/jobs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const job = await queue.getJob(id);
    
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json(job);
  } catch (error: any) {
    console.error('[API] Get job error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stats
 * Get queue statistics
 */
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const stats = await queue.getStats();
    res.json(stats);
  } catch (error: any) {
    console.error('[API] Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Start the API server
 */
export function startServer(): void {
  const port = AppConfig.port;
  app.listen(port, () => {
    console.log(`[API] Server listening on http://localhost:${port}`);
    console.log(`[API] Endpoints:`);
    console.log(`  POST /api/enqueue - Submit a job (Supports Idempotency-Key)`);
    console.log(`  POST /api/webhook - Submit a remote HTTP job`);
    console.log(`  GET  /api/jobs/:id - Get job status`);
    console.log(`  GET  /api/stats - Get queue statistics`);
  });
}
