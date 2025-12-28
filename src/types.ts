export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'delayed';

export interface Job<T = any> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  createdAt: number;
  attempts: number;
  maxRetries: number;
  lastAttemptedAt?: number;
  error?: string;
}

export interface WebhookPayload {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

export type JobHandler<T = any> = (job: Job<T>) => Promise<void>;

export const SYSTEM_JOB_TYPES = {
  WEBHOOK: 'system:webhook'
};

