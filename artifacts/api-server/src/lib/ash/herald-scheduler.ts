import { logger } from "../logger";
import { sweepTheWalls } from "./herald";
import { isHeraldScheduleEnabled } from "./herald-policy";

const HERALD_INTERVAL_MS = 3 * 60 * 60_000;
let schedulerStarted = false;

export function startHeraldScheduler(): void {
  if (schedulerStarted) return;
  const enabled = isHeraldScheduleEnabled(
    process.env["HERALD_SCHEDULE_ENABLED"],
    process.env["NODE_ENV"],
    process.env["REPLIT_DEPLOYMENT"],
  );
  if (!enabled) {
    logger.info(
      {
        flag: process.env["HERALD_SCHEDULE_ENABLED"] ?? "unset",
        nodeEnv: process.env["NODE_ENV"] ?? "unset",
        replitDeployment: process.env["REPLIT_DEPLOYMENT"] === "1",
      },
      "Scheduled Herald sweeps disabled",
    );
    return;
  }

  schedulerStarted = true;
  const timer = setInterval(() => {
    void sweepTheWalls(false, "schedule")
      .then((added) => logger.info({ added }, "Scheduled Herald sweep finished"))
      .catch((err: unknown) => logger.error({ err }, "Scheduled Herald sweep crashed"));
  }, HERALD_INTERVAL_MS);
  timer.unref();
  logger.info({ intervalMs: HERALD_INTERVAL_MS }, "Scheduled Herald sweeps enabled");
}
