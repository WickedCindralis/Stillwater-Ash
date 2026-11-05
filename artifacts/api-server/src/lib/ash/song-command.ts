export type SongCommand = {
  text: string;
  prompt: string | null;
  title: string | null;
  lyrics: string | null;
  error: string | null;
};

export function stripSongCommand(reply: string): SongCommand {
  const descriptions: string[] = [];
  const titles: string[] = [];
  const lyricBlocks: string[] = [];
  let malformedLyrics = false;
  let cleaned = reply.replace(
    /^[ \t]*\[SONG LYRICS\][ \t]*\r?\n([\s\S]*?)^[ \t]*\[\/SONG LYRICS\][ \t]*\r?$/gim,
    (_block, body: string) => {
      lyricBlocks.push(body.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
      return "";
    },
  );
  if (/^[ \t]*\[SONG LYRICS\]/im.test(cleaned)) {
    malformedLyrics = true;
    cleaned = cleaned.replace(/^[ \t]*\[SONG LYRICS\][\s\S]*/im, "");
  }
  if (/^[ \t]*\[\/SONG LYRICS\][ \t]*$/im.test(cleaned)) malformedLyrics = true;
  cleaned = cleaned.replace(/^[ \t]*\[\/SONG LYRICS\][ \t]*\r?$/gim, "");
  cleaned = cleaned.replace(/^[ \t]*SONG TITLE:[ \t]*([^\r\n]*)[ \t]*\r?$/gim, (_line, title: string) => {
    titles.push(title.trim());
    return "";
  });
  let count = 0;
  const text = cleaned.replace(/^[ \t]*SONG:[ \t]*([^\r\n]*)[ \t]*\r?$/gim, (_line, description: string) => {
    count += 1;
    descriptions.push(description.trim());
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  const rejected = (error: string): SongCommand => ({
    text, prompt: descriptions[0] ?? null, title: titles[0] ?? null, lyrics: lyricBlocks[0] ?? null, error,
  });
  if (count === 0) {
    if (titles.length || lyricBlocks.length || malformedLyrics) return rejected("SONG TITLE and SONG LYRICS require a SONG command");
    return { text: reply, prompt: null, title: null, lyrics: null, error: null };
  }
  if (count > 1) return rejected("Only one SONG command may be used per response");
  const prompt = descriptions[0];
  if (!prompt || prompt.length > 400) {
    return rejected("SONG description must be between 1 and 400 characters");
  }
  if (malformedLyrics || lyricBlocks.length > 1) return rejected("SONG LYRICS block must have one matching closing tag");
  if (titles.length > 1) return rejected("Only one SONG TITLE may be used");
  const lyrics = lyricBlocks[0] ?? null;
  const title = titles[0] ?? null;
  if (lyrics !== null && (!lyrics || lyrics.length > 700)) {
    return rejected("SONG LYRICS must be between 1 and 700 characters");
  }
  if (lyrics !== null && (!title || title.length > 80)) {
    return rejected("SONG TITLE must be between 1 and 80 characters when writing lyrics");
  }
  if (title !== null && lyrics === null) return rejected("SONG TITLE requires a SONG LYRICS block");
  return { text, prompt, title, lyrics, error: null };
}