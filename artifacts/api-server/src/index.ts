import app from "./app";
import { logger } from "./lib/logger";
import { ashBridge } from "./lib/ash/bridge";
import { storage } from "./lib/ash/storage";

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
});
