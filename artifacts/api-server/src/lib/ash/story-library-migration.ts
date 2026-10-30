import { and, eq, max } from "drizzle-orm";
import { ashBooks, ashState, ashStory, ashStoryChapters, db, pool } from "@workspace/db";
import { logger } from "../logger";

/**
 * Copies the legacy manuscript metadata into the first book without changing
 * any legacy row. Its existing chapter/run ids already use story_id = "ash".
 */
export async function migrateLegacyStoryToBook(title: string): Promise<boolean> {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("The first book title is required");

  return db.transaction(async (tx) => {
    const [existingBook] = await tx.select({ id: ashBooks.id })
      .from(ashBooks)
      .where(eq(ashBooks.id, "ash"))
      .limit(1);
    if (existingBook) return false;

    const [legacy] = await tx.select().from(ashStory)
      .where(eq(ashStory.id, "ash"))
      .limit(1);
    if (!legacy) throw new Error("The legacy manuscript was not found; no book was created");

    const [state] = await tx.select({ storyPacket: ashState.personaStoryPacket })
      .from(ashState)
      .where(eq(ashState.id, "ash"))
      .limit(1);
    const [chapterDates] = await tx.select({
      lastWrittenAt: max(ashStoryChapters.updatedAt),
    }).from(ashStoryChapters).where(and(eq(ashStoryChapters.storyId, "ash")));

    await tx.insert(ashBooks).values({
      id: "ash",
      title: cleanTitle,
      storyPacket: legacy.storyPacket || state?.storyPacket || "",
      rollingSummary: legacy.rollingSummary,
      runStatus: legacy.runStatus,
      activeRunId: legacy.activeRunId,
      createdAt: legacy.createdAt,
      lastWrittenAt: chapterDates?.lastWrittenAt ?? null,
    });
    return true;
  });
}

const cliTitle = process.argv[2];
if (process.argv[1]?.includes("story-library-migration")) {
  void migrateLegacyStoryToBook(cliTitle || "")
    .then((created) => {
      logger.info({ created }, "Story library migration finished");
    })
    .catch((error) => {
      logger.error({ err: error }, "Story library migration failed");
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
