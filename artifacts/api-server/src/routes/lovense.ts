import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { acceptLovenseCallback, disconnectLovense, lovenseStatus, startLovensePairing } from "../lib/ash/lovense";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

function callbackUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}/api/lovense/callback`;
}

router.get("/status", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(await lovenseStatus(callbackUrl(req)));
  } catch (error) {
    logger.error({ error }, "[ash-lovense] Could not read pairing status");
    res.status(500).json({ error: "Could not read Lovense pairing status" });
  }
});

router.post("/pair", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(await startLovensePairing(callbackUrl(req)));
  } catch (error) {
    logger.error({ error }, "[ash-lovense] Pairing QR request failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Lovense pairing failed" });
  }
});

// Lovense Remote sends this without a Stillwater session. Only the unguessable
// utoken from the latest authenticated QR request can activate a pairing.
router.post("/callback", async (req, res): Promise<void> => {
  try {
    if (!(await acceptLovenseCallback(req.body))) {
      res.status(403).json({ error: "Invalid or expired pairing" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error({ error }, "[ash-lovense] Pairing callback failed");
    res.status(500).json({ error: "Pairing callback failed" });
  }
});

router.post("/disconnect", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(await disconnectLovense(callbackUrl(req)));
  } catch (error) {
    logger.error({ error }, "[ash-lovense] Disconnect failed");
    res.status(500).json({ error: "Could not remove Lovense access" });
  }
});

export default router;