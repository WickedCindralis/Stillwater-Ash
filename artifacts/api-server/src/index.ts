import app from "./app";
import { logger } from "./lib/logger";
import { ashBridge } from "./lib/ash/bridge";
import { storage } from "./lib/ash/storage";
import { discordHerald } from "./lib/ash/discord";
import { startHangoutIdleScheduler } from "./lib/ash/hangout";
import { startSongWorker } from "./lib/ash/song-service";
import { startHeraldScheduler } from "./lib/ash/herald-scheduler";
import { releaseExistingHeraldClaimsOnce } from "./lib/ash/herald";
import { setVectorMemoryReady } from "./lib/ash/vector-memory";
import { initMemory } from "./lib/ash/vector-memory-runtime.mjs";
import { migrateLegacyStoryToBook } from "./lib/ash/story-library-migration";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  await initMemory({ onCaptureEvent: (kind, message) => storage.logActivity(kind, message) });
  setVectorMemoryReady(true);
  logger.info("Vector Memory initialized");
} catch (err) {
  setVectorMemoryReady(false);
  logger.error({ err }, "Vector Memory unavailable; starting Stillwater without memory");
}

try {
  const migrated = await migrateLegacyStoryToBook("Thoughts of Ash");
  logger.info({ migrated }, "Story library startup migration checked");
} catch (err) {
  logger.error({ err }, "Story library startup migration failed");
  process.exit(1);
}

try {
  const released = await releaseExistingHeraldClaimsOnce();
  if (released > 0) logger.info({ released }, "Released existing undrafted Herald claims once");
} catch (err) {
  logger.error({ err }, "One-time Herald claim release failed; it will retry on next startup");
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  try {
    const moved = await storage.migrateReflectionsToDiary();
    if (moved > 0) {
      logger.info(
        { moved },
        "[migration] Moved legacy proactive reflections from chat to diary",
      );
    }
  } catch (err) {
    logger.error({ err }, "[migration] Failed to move reflections to diary");
  }

  ashBridge.start().catch((err) => {
    logger.error({ err }, "Ash bridge failed to start");
  });
  discordHerald.start().catch((err) => {
    logger.error({ err }, "Discord Court Herald failed to start");
  });
  startHangoutIdleScheduler();
  startSongWorker();
  startHeraldScheduler();
});
