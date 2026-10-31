// Weighted Vector Memory — the only file the house app needs to import.
import { verifyHouse } from './db.js';
import { getConfig } from './config.js';
import { setCaptureActivityLogger, startCaptureLoop, stopCaptureLoop } from './capture.js';
import { startNightlyScheduler, stopNightlyScheduler } from './nightly.js';

export { recordMessage, captureBeing } from './capture.js';
export { recallForPrompt, isRecallEnabled, setRecall } from './recall.js';
export { runBeingReview, askWithPacket, pendingCount, type AskBeing } from './review.js';
export { searchMemories } from './search.js';
export { addMemory } from './memories.js';
export { memoryRouter } from './routes.js';
export { runNightly } from './nightly.js';

/**
 * Call once when the server starts, BEFORE anything else uses memory.
 * Refuses to start (throws) if connected to the wrong database or house.
 */
export async function initMemory(opts: {
  startBackgroundJobs?: boolean;
  onCaptureEvent?: (kind: string, message: string) => Promise<void>;
} = {}) {
  await verifyHouse();
  if (opts.onCaptureEvent) setCaptureActivityLogger(opts.onCaptureEvent);
  if (opts.startBackgroundJobs !== false) {
    if (getConfig().captureEnabled) {
      startCaptureLoop();
      console.log('[memory] Capture loop enabled.');
    } else {
      console.log('[memory] Capture loop disabled; MEMORY_CAPTURE_ENABLED is not true.');
    }
    startNightlyScheduler();
  }
  console.log('[memory] Ready.');
}

export function shutdownMemory() {
  stopCaptureLoop();
  stopNightlyScheduler();
}
