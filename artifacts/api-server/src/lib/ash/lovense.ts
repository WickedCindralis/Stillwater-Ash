import { createHash, randomBytes } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db, ashLovense, ashState } from "@workspace/db";
import { logger } from "../logger";
import { createLovenseQr, sendLovenseCommand } from "./lovense-provider";
import type { KingsFingersCommand } from "./kings-fingers-command";

const PAIRING_LIFETIME_MS = 4 * 60 * 60_000;
const OWNER_ROW = "ash";
const DEVICE_LOCK = 8812341;

function requireDeployment(): void {
  if (process.env["REPLIT_DEPLOYMENT"] !== "1") {
    throw new Error("Lovense pairing and device commands are available only on the published Stillwater app");
  }
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function developerToken(): string {
  const token = process.env["LOVENSE_TOKEN"]?.trim();
  if (!token) throw new Error("Lovense developer token is not configured");
  return token;
}

export async function lovenseStatus(callbackUrl: string) {
  if (process.env["REPLIT_DEPLOYMENT"] !== "1") {
    return { configured: false, connected: false, qrUrl: null, expiresAt: null, callbackUrl: "", previewOnly: true };
  }
  const [pair] = await db.select().from(ashLovense).where(eq(ashLovense.id, OWNER_ROW)).limit(1);
  return {
    configured: !!process.env["LOVENSE_TOKEN"]?.trim(),
    connected: !!pair?.uid && !!pair?.toyId,
    qrUrl: pair?.pendingUid && pair.expiresAt && pair.expiresAt.getTime() > Date.now()
      ? pair.qrUrl : null,
    expiresAt: pair?.pendingUid && pair.expiresAt && pair.expiresAt.getTime() > Date.now()
      ? pair.expiresAt.toISOString() : null,
    callbackUrl,
    previewOnly: false,
  };
}

export async function startLovensePairing(callbackUrl: string) {
  requireDeployment();
  const token = developerToken();
  // The UID identifies this app's pairing, not the owner's Lovense account.
  const uid = `wicked_${Date.now()}`;
  // Unlike a timestamp, this verification token cannot be guessed by a caller
  // trying to forge Lovense's unauthenticated callback endpoint.
  const utoken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PAIRING_LIFETIME_MS);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEVICE_LOCK})`);
    await tx.insert(ashLovense).values({
      id: OWNER_ROW, pendingUid: uid, pendingTokenHash: tokenHash(utoken), expiresAt,
    }).onConflictDoUpdate({
      target: ashLovense.id,
      set: { pendingUid: uid, pendingTokenHash: tokenHash(utoken), qrUrl: "", expiresAt, updatedAt: new Date() },
    });
  });
  logger.info("[ash-lovense] Pairing QR request started");
  let qrUrl: string;
  try {
    qrUrl = await createLovenseQr(uid, utoken, token);
  } catch (error) {
    await db.update(ashLovense).set({ pendingUid: "", pendingTokenHash: "", qrUrl: "", expiresAt: null })
      .where(and(eq(ashLovense.id, OWNER_ROW), eq(ashLovense.pendingUid, uid),
        eq(ashLovense.pendingTokenHash, tokenHash(utoken))));
    throw error;
  }
  const [saved] = await db.update(ashLovense).set({ qrUrl, updatedAt: new Date() })
    .where(and(eq(ashLovense.id, OWNER_ROW), eq(ashLovense.pendingUid, uid),
      eq(ashLovense.pendingTokenHash, tokenHash(utoken))))
    .returning({ id: ashLovense.id });
  if (!saved) throw new Error("Pairing QR was superseded or cancelled");
  logger.info("[ash-lovense] Pairing QR issued; waiting for verified Remote callback");
  return lovenseStatus(callbackUrl);
}

export async function acceptLovenseCallback(value: unknown): Promise<boolean> {
  requireDeployment();
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.uid !== "string" || typeof body.utoken !== "string" || !body.utoken) return false;
  if (!body.toys || typeof body.toys !== "object" || Array.isArray(body.toys)) return false;
  const activeToys = Object.entries(body.toys).filter(([, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return (value as Record<string, unknown>).status == 1;
  });
  // Omission of `toy` in Lovense's command request actuates ALL toys.
  if (activeToys.length !== 1) {
    logger.warn({ toyCount: activeToys.length }, "[ash-lovense] Pairing rejected; exactly one active toy is required");
    return false;
  }
  const [toyKey, toy] = activeToys[0];
  const toyId = (toy as Record<string, unknown>).id || toyKey;
  if (typeof toyId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(toyId)) return false;
  const hash = tokenHash(body.utoken);
  const accepted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEVICE_LOCK})`);
    const [pair] = await tx.select().from(ashLovense).where(eq(ashLovense.id, OWNER_ROW)).limit(1);
    if (!pair || !pair.pendingUid || body.uid !== pair.pendingUid || !pair.expiresAt ||
        pair.expiresAt.getTime() <= Date.now() || hash !== pair.pendingTokenHash) return false;
    const [updated] = await tx.update(ashLovense).set({
      uid: pair.pendingUid, toyId, pairedAt: new Date(), pendingUid: "",
      pendingTokenHash: "", qrUrl: "", expiresAt: null, updatedAt: new Date(),
    }).where(and(eq(ashLovense.id, OWNER_ROW), eq(ashLovense.pendingUid, pair.pendingUid),
      eq(ashLovense.pendingTokenHash, hash))).returning({ id: ashLovense.id });
    return !!updated;
  });
  if (!accepted) return false;
  logger.info("[ash-lovense] Remote pairing callback verified; device controls enabled for private chat");
  return true;
}

export async function disconnectLovense(callbackUrl: string) {
  requireDeployment();
  let stopWarning: string | null = null;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEVICE_LOCK})`);
    const [pair] = await tx.select().from(ashLovense).where(eq(ashLovense.id, OWNER_ROW)).limit(1);
    if (pair?.uid && pair.toyId) {
      // Best effort: the owner must still be able to revoke access when Remote is
      // offline, but do not silently claim that the physical device stopped.
      try {
        logger.info("[ash-lovense] Device stop request started before disconnect");
        await sendLovenseCommand(pair.uid, developerToken(), pair.toyId, { kind: "STOP" });
        logger.info("[ash-lovense] Device stop accepted before disconnect");
      } catch (error) {
        logger.error({ error }, "[ash-lovense] Device stop could not be confirmed during disconnect");
        stopWarning = "Stillwater access was removed, but the device stop could not be confirmed. Stop it in Lovense Remote if it is still running.";
      }
    }
    await tx.insert(ashLovense).values({ id: OWNER_ROW }).onConflictDoUpdate({
      target: ashLovense.id,
      set: { uid: "", toyId: "", pairedAt: null, pendingUid: "", pendingTokenHash: "", qrUrl: "", expiresAt: null, updatedAt: new Date() },
    });
  });
  logger.info("[ash-lovense] Device access removed from Stillwater");
  return { ...await lovenseStatus(callbackUrl), stopWarning };
}

export async function sendKingsFingers(command: KingsFingersCommand): Promise<void> {
  requireDeployment();
  const token = developerToken();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEVICE_LOCK})`);
    const [state] = await tx.select({ killSwitch: ashState.apiKillSwitch }).from(ashState)
      .where(eq(ashState.id, OWNER_ROW)).limit(1).for("update");
    if (!state || state.killSwitch === 1) throw new Error("Ash's API bridge is off");
    const [pair] = await tx.select({ uid: ashLovense.uid, toyId: ashLovense.toyId }).from(ashLovense)
      .where(eq(ashLovense.id, OWNER_ROW)).limit(1);
    if (!pair?.uid || !pair.toyId) throw new Error("No Lovense device is paired with Stillwater");
    logger.info({ action: command.kind }, "[ash-lovense] Provider device command request started");
    await sendLovenseCommand(pair.uid, token, pair.toyId, command);
    logger.info({ action: command.kind }, "[ash-lovense] Provider device command accepted");
  });
}