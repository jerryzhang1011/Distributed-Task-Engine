export const AppConfig = {
  // Redis connection URL
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // API server port
  port: parseInt(process.env.PORT || '3000', 10),

  // Whether to automatically scan the handlers directory and register files as jobs
  // The filename becomes the job type (e.g., emailHandler.ts -> type: "emailHandler")
  autoDiscoverHandlers: true,

  // Manual configuration mapping (takes precedence over auto-discovery)
  // Format: { 'job-type': 'handler-file-name' } (without extension)
  handlerMap: {
    'send-email': 'emailHandler'
  },

  // Default max retries for jobs
  defaultMaxRetries: 3,

  // Backoff multiplier in milliseconds (exponential: 1s, 2s, 4s...)
  backoffMultiplierMs: 1000
};

