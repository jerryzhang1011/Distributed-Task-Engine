import Redis, { Redis as RedisClient } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { Job, JobStatus } from '../types';
import { AppConfig } from '../config';

export interface EnqueueOptions {
  maxRetries?: number;
  idempotencyKey?: string;
}

export class QueueClient {
  private redis: RedisClient;
  private readonly QUEUE_PREFIX = 'queue:';

  constructor(redisUrl: string = AppConfig.redisUrl) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null // Disable max retries limit for blocking commands
    });
  }

  private getKey(key: string): string {
    return `${this.QUEUE_PREFIX}${key}`;
  }

  /**
   * Add a new job to the pending queue
   */
  async enqueue<T>(type: string, payload: T, options: EnqueueOptions = {}): Promise<Job<T>> {
    // 1. Idempotency Check
    if (options.idempotencyKey) {
      const existingJobId = await this.redis.get(this.getKey(`idempotency:${options.idempotencyKey}`));
      if (existingJobId) {
        console.log(`[Queue] Idempotency hit: ${options.idempotencyKey} -> Job ${existingJobId}`);
        const existingJob = await this.getJob(existingJobId);
        if (existingJob) {
          return existingJob as Job<T>;
        }
        // If key exists but job data is gone (e.g. expired), we proceed to create new job
      }
    }

    const job: Job<T> = {
      id: uuidv4(),
      type,
      payload,
      status: 'pending',
      createdAt: Date.now(),
      attempts: 0,
      maxRetries: options.maxRetries ?? AppConfig.defaultMaxRetries
    };

    const multi = this.redis.multi();
    
    // Store job data in a hash
    multi.hset(this.getKey(`job:${job.id}`), 'data', JSON.stringify(job));
    
    // Add job ID to pending queue (FIFO: push left, pop right)
    multi.lpush(this.getKey('pending'), job.id);

    // Save Idempotency Key (Expire in 24h)
    if (options.idempotencyKey) {
      multi.set(this.getKey(`idempotency:${options.idempotencyKey}`), job.id, 'EX', 86400);
    }

    await multi.exec();
    return job;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    const data = await this.redis.hget(this.getKey(`job:${jobId}`), 'data');
    if (!data) return null;
    return JSON.parse(data);
  }

  /**
   * Atomically move a job from pending to processing queue
   * Uses BRPOPLPUSH for reliability - if worker crashes, job is still in processing queue
   */
  async moveToProcessing(timeoutSeconds: number = 2): Promise<Job | null> {
    // BRPOPLPUSH: Blocking pop from pending, push to processing (atomic)
    const jobId = await this.redis.brpoplpush(
      this.getKey('pending'),
      this.getKey('processing'),
      timeoutSeconds
    );

    if (!jobId) return null;

    // Update job status
    const job = await this.getJob(jobId);
    if (job) {
      job.status = 'processing';
      job.lastAttemptedAt = Date.now();
      job.attempts += 1;
      await this.redis.hset(this.getKey(`job:${jobId}`), 'data', JSON.stringify(job));
      return job;
    }
    return null;
  }

  /**
   * Mark job as completed and remove from processing queue
   */
  async completeJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    job.status = 'completed';

    const multi = this.redis.multi();
    multi.lrem(this.getKey('processing'), 0, jobId);
    multi.hset(this.getKey(`job:${jobId}`), 'data', JSON.stringify(job));
    // Set TTL for completed jobs (24 hours)
    multi.expire(this.getKey(`job:${jobId}`), 3600 * 24);

    await multi.exec();
  }

  /**
   * Handle job failure - either schedule retry or move to DLQ
   * @param retryAfterMs - If provided, schedule retry after this many milliseconds. If not, move to DLQ.
   */
  async failJob(jobId: string, error: Error, retryAfterMs?: number): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    job.error = error.message;
    
    const multi = this.redis.multi();
    multi.lrem(this.getKey('processing'), 0, jobId);

    if (retryAfterMs && retryAfterMs > 0) {
      // Schedule for retry using ZSET (score = timestamp when to retry)
      job.status = 'delayed';
      const retryAt = Date.now() + retryAfterMs;
      multi.zadd(this.getKey('delayed'), retryAt, jobId);
    } else {
      // Move to Dead Letter Queue
      job.status = 'failed';
      multi.lpush(this.getKey('dead-letter'), jobId);
    }

    multi.hset(this.getKey(`job:${jobId}`), 'data', JSON.stringify(job));
    await multi.exec();
  }

  /**
   * Process delayed jobs that are ready to be retried
   * Moves them from the delayed ZSET back to the pending queue
   */
  async processDelayedJobs(): Promise<number> {
    const now = Date.now();
    // Get jobs ready to be retried (score <= now)
    const jobIds = await this.redis.zrangebyscore(
      this.getKey('delayed'),
      '-inf',
      now,
      'LIMIT',
      0,
      10
    );

    if (jobIds.length === 0) return 0;

    const multi = this.redis.multi();
    for (const jobId of jobIds) {
      multi.zrem(this.getKey('delayed'), jobId);
      multi.lpush(this.getKey('pending'), jobId);
    }
    await multi.exec();

    console.log(`[Queue] Re-queued ${jobIds.length} delayed jobs`);
    return jobIds.length;
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    delayed: number;
    deadLetter: number;
  }> {
    const [pending, processing, delayed, deadLetter] = await Promise.all([
      this.redis.llen(this.getKey('pending')),
      this.redis.llen(this.getKey('processing')),
      this.redis.zcard(this.getKey('delayed')),
      this.redis.llen(this.getKey('dead-letter'))
    ]);

    return { pending, processing, delayed, deadLetter };
  }

  /**
   * Gracefully close Redis connection
   */
  async quit(): Promise<void> {
    await this.redis.quit();
  }
}
