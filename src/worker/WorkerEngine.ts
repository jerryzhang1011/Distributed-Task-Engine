import { QueueClient } from '../lib/QueueClient';
import { Job, JobHandler, SYSTEM_JOB_TYPES } from '../types';
import { AppConfig } from '../config';
import { httpHandler } from '../handlers/httpHandler';

export class WorkerEngine {
  private queue: QueueClient;
  private handlers: Map<string, JobHandler> = new Map();
  private isRunning: boolean = false;
  private delayedJobInterval: NodeJS.Timeout | null = null;
  
  // Concurrency control
  private readonly concurrency: number;
  private activeJobs: number = 0;
  private jobsProcessed: number = 0;
  private startTime: number = 0;

  constructor(queue: QueueClient) {
    this.queue = queue;
    this.concurrency = AppConfig.workerConcurrency;
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
   * Start the worker event loop with concurrent processing
   */
  async start(): Promise<void> {
    this.isRunning = true;
    this.startTime = Date.now();
    console.log(`[Worker] Engine started with concurrency=${this.concurrency}, polling for jobs...`);

    // Start background loop for processing delayed jobs
    this.startDelayedJobLoop();

    // Start stats logging
    this.startStatsLoop();

    while (this.isRunning) {
      try {
        // Check if we have capacity for more concurrent jobs
        if (this.activeJobs >= this.concurrency) {
          // At capacity, wait a bit before checking again
          await this.sleep(AppConfig.pollingIntervalMs);
          continue;
        }

        // Try to get a job (non-blocking with short timeout)
        const job = await this.queue.moveToProcessing(1);
        
        if (job) {
          // Increment active counter BEFORE starting job
          this.activeJobs++;
          
          // Fire-and-forget: execute job without awaiting
          // This allows us to immediately loop back and grab more jobs
          this.executeJobAsync(job);
        }
        // If no job available, the blocking call already waited ~1s
      } catch (error) {
        console.error('[Worker] Error in main loop:', error);
        // Cool off before retrying to avoid tight error loops
        await this.sleep(1000);
      }
    }

    // Wait for all active jobs to complete before fully stopping
    await this.drainActiveJobs();
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    console.log('[Worker] Stopping... waiting for active jobs to complete');
    this.isRunning = false;
    if (this.delayedJobInterval) {
      clearInterval(this.delayedJobInterval);
    }
  }

  /**
   * Wait for all active jobs to finish (graceful shutdown)
   */
  private async drainActiveJobs(): Promise<void> {
    const maxWaitMs = 30000; // 30 second timeout
    const startWait = Date.now();
    
    while (this.activeJobs > 0 && (Date.now() - startWait) < maxWaitMs) {
      console.log(`[Worker] Draining... ${this.activeJobs} jobs still active`);
      await this.sleep(500);
    }
    
    if (this.activeJobs > 0) {
      console.warn(`[Worker] Force shutdown with ${this.activeJobs} jobs still running`);
    } else {
      console.log('[Worker] All jobs drained successfully');
    }
  }

  /**
   * Execute a job asynchronously (fire-and-forget pattern)
   */
  private executeJobAsync(job: Job): void {
    console.log(`[Worker] Processing job ${job.id} (Type: ${job.type}, Attempt: ${job.attempts}, Active: ${this.activeJobs}/${this.concurrency})`);
    
    this.executeJob(job)
      .catch(err => {
        console.error(`[Worker] Unhandled error in job ${job.id}:`, err);
      })
      .finally(() => {
        this.activeJobs--;
        this.jobsProcessed++;
      });
  }

  /**
   * Log throughput stats periodically
   */
  private startStatsLoop(): void {
    setInterval(() => {
      if (!this.isRunning) return;
      const elapsed = (Date.now() - this.startTime) / 1000;
      const tps = elapsed > 0 ? (this.jobsProcessed / elapsed).toFixed(2) : 0;
      console.log(`[Worker] Stats: processed=${this.jobsProcessed}, active=${this.activeJobs}, TPS=${tps}`);
    }, 10000); // Log every 10 seconds
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

