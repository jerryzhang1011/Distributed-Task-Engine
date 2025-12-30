# Distributed Task Engine

A robust, distributed job queue system built with **Node.js** and **Redis**. Designed for reliability, scalability, and ease of extension.

## 🚀 Features

- **Reliable Queuing**: Uses Redis `BRPOPLPUSH` for atomic moves, ensuring zero job loss even if workers crash.
- **High Concurrency**: Each worker instance processes multiple jobs simultaneously (default: 20 concurrent jobs).
- **Idempotency Support**: Prevents duplicate job processing using `Idempotency-Key` headers (deduplication window: 24h).
- **Smart Retries**: Automatic retries with **Exponential Backoff** (1s, 2s, 4s...) for transient failures.
- **Dead Letter Queue (DLQ)**: Failed jobs are moved to a separate queue after max retries.
- **Plug & Play Handlers**: Simply drop a `.ts` file into `src/handlers/` to create a new job type.
- **Remote Webhooks**: Built-in support for executing HTTP requests (Webhooks) as background jobs.
- **Delayed Jobs**: Support for scheduling retries in the future using Redis Sorted Sets.
- **Graceful Shutdown**: Waits for active jobs to complete before exiting.
- **Real-time Stats**: Built-in TPS (throughput) monitoring.

## ⚡ Performance

This engine is designed for **high throughput**:

| Scenario | Single Worker TPS | With 5 Workers |
|----------|-------------------|----------------|
| I/O-bound tasks (HTTP, Email) | 50-200+ | 250-1000+ |
| Fast local tasks (<10ms) | 500-1000+ | 2500-5000+ |
| CPU-bound tasks | Limited by CPU | Scale horizontally |

> **Note**: Actual performance depends on task duration, Redis latency, and system resources.

### Why is it fast?

- **Non-blocking I/O**: Leverages Node.js async/await to process multiple I/O-bound jobs concurrently.
- **Fire-and-forget pattern**: Jobs are dispatched without blocking the main loop.
- **Redis efficiency**: `BRPOPLPUSH` provides O(1) atomic job acquisition with minimal overhead.

## 🛠️ Tech Stack

- **Runtime**: Node.js (TypeScript)
- **Queue Store**: Redis (List, Hash, ZSet)
- **API**: Express.js

## 📦 Getting Started

### Prerequisites
- Node.js (v18+)
- Docker (for Redis)

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Start Redis
docker-compose up -d

# 3. Start the Service (API + Worker)
npm run dev
```

### Configuration

Set these environment variables to customize behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PORT` | `3000` | API server port |
| `WORKER_CONCURRENCY` | `20` | Max concurrent jobs per worker |

Example:
```bash
WORKER_CONCURRENCY=50 npm run dev
```

### Stopping the Service

To stop the service and Redis:

1. Stop the Node.js process: `Ctrl + C` (waits for active jobs to drain)
2. Stop Redis:
```bash
docker-compose down
```

## 💡 Usage

### 1. Create a Custom Job Handler
Create a file `src/handlers/imageResize.ts`:

```typescript
import { Job } from '../types';

export default async function imageResize(job: Job) {
  const { url, width } = job.payload;
  console.log(`Resizing ${url} to ${width}px...`);
  // Your logic here
}
```
*The job type will automatically be `imageResize`.*

### 2. Submit a Job via API

Support for idempotency: send `Idempotency-Key` header to prevent duplicate jobs.

```bash
curl -X POST http://localhost:3000/api/enqueue \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-req-id-123" \
  -d '{
    "type": "imageResize",
    "payload": {
      "url": "https://example.com/photo.jpg",
      "width": 800
    }
  }'
```

### 3. Submit a Remote Webhook (Built-in)
No code needed! Just call the webhook endpoint:

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: webhook-req-abc" \
  -d '{
    "url": "https://httpbin.org/post",
    "method": "POST",
    "body": { "hello": "world" }
  }'
```

## 📊 Monitoring

- **Get Job Status**: `GET /api/jobs/:id`
- **Get Queue Stats**: `GET /api/stats`
- **Worker Logs**: TPS and active job counts are logged every 10 seconds

Example log output:
```
[Worker] Stats: processed=1523, active=18, TPS=45.21
```

## 📁 Project Structure

```
src/
├── api/          # REST API Endpoints
├── handlers/     # ⚡️ Drop your custom job handlers here
├── lib/          # Redis wrapper & core queue logic
├── worker/       # Worker engine (concurrent processing, retrying)
├── config.ts     # Configuration (concurrency, Redis, etc.)
└── index.ts      # Entry point
```

## 🛡️ Reliability

- **At-least-once Delivery**: Jobs are moved to a `processing` queue before execution.
- **Crash Recovery**: If a worker dies, the job remains in `processing` and can be recovered (manual or timeout).
- **Graceful Shutdown**: Handles `SIGTERM`/`SIGINT` to finish current jobs before exiting.
- **Concurrent Draining**: On shutdown, waits up to 30s for active jobs to complete.

## 🔧 Scaling

To handle more load, simply run multiple worker instances:

```bash
# Terminal 1
WORKER_CONCURRENCY=50 npm run dev

# Terminal 2 (different machine or container)
WORKER_CONCURRENCY=50 npm run dev
```

Each worker competes for jobs atomically via Redis - no coordination needed!
