# Distributed Task Engine

A robust, distributed job queue system built with **Node.js** and **Redis**. Designed for reliability, scalability, and ease of extension.

## 🚀 Features

- **Reliable Queuing**: Uses Redis `BRPOPLPUSH` for atomic moves, ensuring zero job loss even if workers crash.
- **Smart Retries**: Automatic retries with **Exponential Backoff** (1s, 2s, 4s...) for transient failures.
- **Dead Letter Queue (DLQ)**: Failed jobs are moved to a separate queue after max retries.
- **Plug & Play Handlers**: Simply drop a `.ts` file into `src/handlers/` to create a new job type.
- **Remote Webhooks**: Built-in support for executing HTTP requests (Webhooks) as background jobs.
- **Delayed Jobs**: Support for scheduling retries in the future using Redis Sorted Sets.

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

### Stopping the Service

To stop the service and Redis:

1. Stop the Node.js process: `Ctrl + C`
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

```bash
curl -X POST http://localhost:3000/api/enqueue \
  -H "Content-Type: application/json" \
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
  -d '{
    "url": "https://httpbin.org/post",
    "method": "POST",
    "body": { "hello": "world" }
  }'
```

## 📊 Monitoring

- **Get Job Status**: `GET /api/jobs/:id`
- **Get Queue Stats**: `GET /api/stats`

## 📁 Project Structure

```
src/
├── api/          # REST API Endpoints
├── handlers/     # ⚡️ Drop your custom job handlers here
├── lib/          # Redis wrapper & core queue logic
├── worker/       # Worker engine (polling, retrying)
├── config.ts     # Configuration
└── index.ts      # Entry point
```

## 🛡️ Reliability

- **At-least-once Delivery**: Jobs are moved to a `processing` queue before execution.
- **Crash Recovery**: If a worker dies, the job remains in `processing` and can be recovered (manual or timeout).
- **Graceful Shutdown**: Handles `SIGTERM`/`SIGINT` to finish current jobs before exiting.

