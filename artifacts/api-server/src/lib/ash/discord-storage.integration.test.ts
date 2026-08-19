import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  ashDiscordMessages,
  db,
  pool,
  type AshDiscordChannel,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { storage } from "./storage";

after(async () => {
  await pool.end();
});

test("delivery leases fence stale workers and channel revocation waits for intake", async () => {
  const runId = randomUUID();
  const channelId = `discord-test-channel-${runId}`;
  const guildId = `discord-test-guild-${runId}`;
  const messagePrefix = `discord-test-message-${runId}`;
  const original = await storage.listDiscordChannels();
  const originalInput = original.map(
    ({ channelId, guildId, guildName, channelName }) => ({
      channelId,
      guildId,
      guildName,
      channelName,
    }),
  );
  const testChannel: Omit<AshDiscordChannel, "id" | "selectedAt"> = {
    channelId,
    guildId,
    guildName: "Discord integration test",
    channelName: "lease-test",
  };

  try {
    await storage.replaceDiscordChannels([...originalInput, testChannel]);

    const leaseId = randomUUID();
    const inserted = await storage.recordDiscordMessage({
      discordMessageId: `${messagePrefix}-lease`,
      guildId,
      channelId,
      channelName: "lease-test",
      authorId: "owner",
      authorName: "Owner",
      content: "Ash?",
      kind: "owner_call",
      deliveryStatus: "processing",
      deliveryLeaseId: leaseId,
      deliveryLeaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });

    await storage.recoverDiscordDeliveries();
    assert.equal(
      (await storage.getDiscordMessageById(inserted.message.id))?.deliveryStatus,
      "processing",
      "startup recovery must not steal an unexpired claim",
    );
    assert.equal(
      await storage.beginDiscordDelivery(inserted.message.id, "stale-worker"),
      null,
      "a stale worker must not acquire delivery",
    );
    assert.ok(
      await storage.beginDiscordDelivery(inserted.message.id, leaseId),
      "the current lease holder should acquire delivery once",
    );
    assert.equal(
      await storage.beginDiscordDelivery(inserted.message.id, leaseId),
      null,
      "the same delivery cannot transition to sending twice",
    );
    await storage.recoverDiscordDeliveries();
    assert.equal(
      (await storage.getDiscordMessageById(inserted.message.id))?.deliveryStatus,
      "sending",
      "an unexpired in-flight send must not be recovered",
    );

    await db
      .update(ashDiscordMessages)
      .set({ deliveryLeaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(ashDiscordMessages.id, inserted.message.id));
    await storage.recoverDiscordDeliveries();
    assert.equal(
      (await storage.getDiscordMessageById(inserted.message.id))?.deliveryStatus,
      "failed",
      "an expired uncertain send must fail closed rather than be retried",
    );

    let releaseLock!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let enteredLock!: () => void;
    const entered = new Promise<void>((resolve) => {
      enteredLock = resolve;
    });
    const intake = storage.withDiscordChannelLock(channelId, async () => {
      const retained = await storage.recordDiscordMessage({
        discordMessageId: `${messagePrefix}-intake`,
        guildId,
        channelId,
        channelName: "lease-test",
        authorId: "member",
        authorName: "Member",
        content: "bounded public context",
        kind: "context",
        deliveryStatus: "context",
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        createdAt: new Date(),
      });
      enteredLock();
      await gate;
      return retained.message.id;
    });
    await entered;

    let revocationSettled = false;
    const revocation = storage.replaceDiscordChannels(originalInput).then(() => {
      revocationSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      revocationSettled,
      false,
      "preference revocation must wait for channel intake/delivery locks",
    );
    releaseLock();
    await Promise.all([intake, revocation]);
    assert.equal(revocationSettled, true);
    assert.equal(await storage.isDiscordChannelConfigured(channelId), false);
    const retainedAfterRevocation = await db
      .select({ id: ashDiscordMessages.id })
      .from(ashDiscordMessages)
      .where(like(ashDiscordMessages.discordMessageId, `${messagePrefix}%`));
    assert.deepEqual(
      retainedAfterRevocation,
      [],
      "revocation must erase retained rows for the removed channel",
    );
  } finally {
    await storage.replaceDiscordChannels(originalInput);
    await db
      .delete(ashDiscordMessages)
      .where(like(ashDiscordMessages.discordMessageId, `${messagePrefix}%`));
  }
});