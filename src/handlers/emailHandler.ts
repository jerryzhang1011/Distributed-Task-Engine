import { Job } from '../types';

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

/**
 * Example local handler: Simulates sending an email
 * This demonstrates a local function handler
 */
export async function emailHandler(job: Job<EmailPayload>): Promise<void> {
  const { to, subject, body } = job.payload;
  
  console.log(`[Email] Sending to ${to}...`);
  console.log(`[Email] Subject: ${subject}`);
  
  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Simulate random failure (20% chance) to demonstrate retry logic
  if (Math.random() < 0.2) {
    throw new Error('SMTP Connection Timeout - server not responding');
  }

  console.log(`[Email] Successfully sent to ${to}`);
}

