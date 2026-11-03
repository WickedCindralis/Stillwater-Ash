import { logger } from "../logger";
import { sweepTheWalls } from "./herald";
import {
  HERALD_INITIAL_DELAY_MS,
  HERALD_INTERVAL_MS,
  isHeraldScheduleEnabled,
} from "./herald-policy";

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
  const runScheduledSweep = () => {
    void sweepTheWalls(false, "schedule")
      .then((added) => logger.info({ added }, "Scheduled Herald sweep finished"))
      .catch((err: unknown) => logger.error({ err }, "Scheduled Herald sweep crashed"));
  };
  const initialTimer = setTimeout(() => {
    runScheduledSweep();
    const intervalTimer = setInterval(runScheduledSweep, HERALD_INTERVAL_MS);
    intervalTimer.unref();
  }, HERALD_INITIAL_DELAY_MS);
  initialTimer.unref();
  logger.info(
    { initialDelayMs: HERALD_INITIAL_DELAY_MS, intervalMs: HERALD_INTERVAL_MS },
    "Scheduled Herald sweeps enabled",
  );
}
