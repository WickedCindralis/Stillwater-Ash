export type StoryCommand =
  | { kind: "start" }
  | { kind: "prose"; content: string };

export function parseStoryCommand(response: string): StoryCommand | null {
  const match = response.match(/^\s*\[ASH'S STORY\]\s*([\s\S]*?)\s*$/i);
  if (!match) return null;
  const content = match[1]?.trim() ?? "";
  return content ? { kind: "prose", content } : { kind: "start" };
}

export function selectResumeOutput(chapterContent: string | null | undefined, runOutput: string): string {
  return chapterContent ?? runOutput;
}