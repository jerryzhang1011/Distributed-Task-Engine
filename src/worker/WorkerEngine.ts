import { QueueClient } from '../lib/QueueClient';
import { Job, JobHandler, SYSTEM_JOB_TYPES } from '../types';
import { AppConfig } from '../config';
import { httpHandler } from '../handlers/httpHandler';

export class WorkerEngine {
  private queue: QueueClient;
  private handlers: Map<string, JobHandler> = new Map();
  private isRunning: boolean = false;
  private delayedJobInterval: NodeJS.Timeout | null = null;

  constructor(queue: QueueClient) {
    this.queue = queue;
    // Register built-in webhook handler for remote HTTP calls
    this.register(SYSTEM_JOB_TYPES.WEBHOOK, httpHandler);
  }

  /**
   * Register a handler function for a specific job type
   */
  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
    console.log(`[Worker] Registered handler for job type: ${type}`);
  }

  /**
   * Start the worker event loop
   */
  async start(): Promise<void> {
    this.isRunning = true;
    console.log('[Worker] Engine started, polling for jobs...');

    // Start background loop for processing delayed jobs
    this.startDelayedJobLoop();

    while (this.isRunning) {
      try {
        const job = await this.queue.moveToProcessing();
        
        if (job) {
          console.log(`[Worker] Processing job ${job.id} (Type: ${job.type}, Attempt: ${job.attempts})`);
          await this.executeJob(job);
        }
        // If no job, BRPOPLPUSH times out after 2s, so we loop again
      } catch (error) {
        console.error('[Worker] Error in main loop:', error);
        // Cool off before retrying to avoid tight error loops
        await this.sleep(1000);
      }
    }
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    console.log('[Worker] Stopping...');
    this.isRunning = false;
    if (this.delayedJobInterval) {
      clearInterval(this.delayedJobInterval);
    }
  }

  /**
   * Execute a job with the registered handler
   */
  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);

    if (!handler) {
      console.error(`[Worker] No handler found for type: ${job.type}`);
      // Fail immediately for unknown types - no point retrying
      await this.queue.failJob(job.id, new Error(`No handler registered for type: ${job.type}`));
      return;
    }

    try {
      await handler(job);
      await this.queue.completeJob(job.id);
      console.log(`[Worker] Job ${job.id} completed successfully`);
    } catch (error: any) {
      console.error(`[Worker] Job ${job.id} failed:`, error.message);
      
      const attempts = job.attempts || 1;
      const maxRetries = job.maxRetries ?? AppConfig.defaultMaxRetries;

      if (attempts <= maxRetries) {
        // Exponential backoff: 1s, 2s, 4s, 8s...
        const backoffMs = Math.pow(2, attempts - 1) * AppConfig.backoffMultiplierMs;
        console.log(`[Worker] Scheduling retry for job ${job.id} in ${backoffMs}ms (attempt ${attempts}/${maxRetries})`);
        await this.queue.failJob(job.id, error, backoffMs);
      } else {
        console.error(`[Worker] Job ${job.id} exhausted all ${maxRetries} retries. Moving to DLQ.`);
        await this.queue.failJob(job.id, error);
      }
    }
  }

  /**
   * Background loop to process delayed jobs that are ready for retry
   */
  private startDelayedJobLoop(): void {
    this.delayedJobInterval = setInterval(async () => {
      try {
        await this.queue.processDelayedJobs();
      } catch (error) {
        console.error('[Worker] Error processing delayed jobs:', error);
      }
    }, 5000); // Check every 5 seconds
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

