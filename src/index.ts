import { startServer } from './api/server';
import { QueueClient } from './lib/QueueClient';
import { WorkerEngine } from './worker/WorkerEngine';
import { loadHandlers } from './lib/HandlerLoader';

async function bootstrap(): Promise<void> {
  console.log('='.repeat(50));
  console.log('   Job Queue Service - Starting...');
  console.log('='.repeat(50));

  // 1. Start API Server
  startServer();

  // 2. Initialize Queue and Worker
  const queue = new QueueClient();
  const worker = new WorkerEngine(queue);

  // 3. Dynamically load handlers from config
  console.log('[Bootstrap] Loading handlers...');
  await loadHandlers(worker);

  // 4. Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Bootstrap] Received SIGINT, shutting down gracefully...');
    await worker.stop();
    await queue.quit();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Bootstrap] Received SIGTERM, shutting down gracefully...');
    await worker.stop();
    await queue.quit();
    process.exit(0);
  });

  // 5. Start processing jobs
  await worker.start();
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Fatal error:', err);
  process.exit(1);
});

