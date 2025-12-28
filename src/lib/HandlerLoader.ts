import fs from 'fs';
import path from 'path';
import { WorkerEngine } from '../worker/WorkerEngine';
import { AppConfig } from '../config';

/**
 * Dynamically load handlers from the handlers directory
 * Supports both auto-discovery and manual configuration
 */
export async function loadHandlers(worker: WorkerEngine): Promise<void> {
  const handlersDir = path.join(__dirname, '../handlers');
  
  // Track which files have been manually mapped (to avoid duplicate registration)
  const mappedFiles = new Set(Object.values(AppConfig.handlerMap));

  // 1. Auto-discovery: Scan handlers directory
  if (AppConfig.autoDiscoverHandlers && fs.existsSync(handlersDir)) {
    const files = fs.readdirSync(handlersDir).filter(f => 
      (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')
    );
    
    for (const file of files) {
      const nameWithoutExt = path.parse(file).name;
      
      // Skip if this file is manually mapped (will be handled below)
      if (mappedFiles.has(nameWithoutExt)) continue;
      
      // Skip built-in httpHandler (it's registered by WorkerEngine constructor)
      if (nameWithoutExt === 'httpHandler') continue;
      
      await registerHandlerFromFile(worker, nameWithoutExt, path.join(handlersDir, file));
    }
  }

  // 2. Manual configuration: Register with custom job type names
  for (const [jobType, fileName] of Object.entries(AppConfig.handlerMap)) {
    const filePath = path.join(handlersDir, fileName);
    await registerHandlerFromFile(worker, jobType, filePath);
  }
}

/**
 * Import a handler module and register it with the worker
 */
async function registerHandlerFromFile(
  worker: WorkerEngine, 
  jobType: string, 
  filePath: string
): Promise<void> {
  try {
    // Dynamic import
    const module = await import(filePath);
    
    // Look for handler function: prefer default export, then named export matching filename
    let handler = module.default;
    
    if (!handler) {
      const fileName = path.parse(filePath).name;
      handler = module[fileName];
    }

    if (!handler) {
      // Find first exported function
      const firstFunc = Object.values(module).find(v => typeof v === 'function');
      if (firstFunc) handler = firstFunc;
    }

    if (handler && typeof handler === 'function') {
      worker.register(jobType, handler as any);
    } else {
      console.warn(`[Loader] No valid handler function found in ${filePath} for type "${jobType}"`);
    }
  } catch (error) {
    console.error(`[Loader] Failed to import handler from ${filePath}:`, error);
  }
}

