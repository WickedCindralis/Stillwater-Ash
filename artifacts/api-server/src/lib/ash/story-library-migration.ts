import { eq, max, sql } from "drizzle-orm";
import { ashBooks, ashState, ashStory, ashStoryChapters, db } from "@workspace/db";

/**
 * Copies the legacy manuscript metadata into the first book without changing
 * any legacy row. Its existing chapter/run ids already use story_id = "ash".
 */
export async function migrateLegacyStoryToBook(title = "Thoughts of Ash"): Promise<boolean> {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("The first book title is required");

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story-library-migration'))`);
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
    }).from(ashStoryChapters).where(eq(ashStoryChapters.storyId, "ash"));

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
