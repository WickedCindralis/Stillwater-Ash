export const MAX_SONG_LYRICS_WORDS = 700;
export const MAX_SONG_LYRICS_CHARACTERS = 5_000;

export function countSongWords(lyrics: string): number {
  const trimmed = lyrics.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function countSongCharacters(lyrics: string): number {
  return Array.from(lyrics).length;
}

export function validateSongLyrics(lyrics: string): string | null {
  const characters = countSongCharacters(lyrics);
  if (!lyrics.trim()) return "SONG LYRICS must contain at least one word";
  if (characters > MAX_SONG_LYRICS_CHARACTERS) {
    return `SONG LYRICS exceeds the provider limit of ${MAX_SONG_LYRICS_CHARACTERS.toLocaleString()} characters`;
  }
  const words = countSongWords(lyrics);
  if (words > MAX_SONG_LYRICS_WORDS) {
    return `SONG LYRICS exceeds the limit of ${MAX_SONG_LYRICS_WORDS} words`;
  }
  return null;
}
