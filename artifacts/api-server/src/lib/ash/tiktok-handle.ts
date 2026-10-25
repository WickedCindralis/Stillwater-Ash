export function normalizeTiktokHandle(value: string): string {
  const input = value.trim();
  if (!input) return "";

  let candidate = input;
  if (/^https?:\/\//i.test(input) || /^www\.tiktok\.com\//i.test(input)) {
    try {
      const url = new URL(/^www\./i.test(input) ? `https://${input}` : input);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      if (url.hostname !== "tiktok.com" && !url.hostname.endsWith(".tiktok.com")) return "";
      const match = url.pathname.match(/^\/@([^/]+)/);
      if (!match) return "";
      candidate = decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  } else {
    candidate = input.replace(/^@/, "");
  }

  return /^[a-zA-Z0-9._]+$/.test(candidate) ? candidate : "";
}
