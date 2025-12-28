import { Job } from '../types';

interface MyPayload {
  message: string;
}

export default async function myHandler(job: Job<MyPayload>): Promise<void> {
  const { message } = job.payload;
  console.log(`[myHandler] Received: ${message}`);
  console.log(`[myHandler] Done!`);
}