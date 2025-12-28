import axios from 'axios';
import { Job, WebhookPayload } from '../types';

/**
 * Built-in handler for remote HTTP/Webhook calls
 * This is the "Remote Function" capability
 */
export async function httpHandler(job: Job<WebhookPayload>): Promise<void> {
  const { url, method, headers, body, timeout = 10000 } = job.payload;
  
  console.log(`[Webhook] Calling ${method} ${url}...`);
  
  try {
    const response = await axios({
      method,
      url,
      headers,
      data: body,
      timeout
    });
    
    console.log(`[Webhook] ${url} completed. Status: ${response.status}`);
  } catch (error: any) {
    if (error.isAxiosError) {
      throw new Error(`Webhook failed: ${error.response?.status || error.code} - ${error.message}`);
    }
    throw error;
  }
}

