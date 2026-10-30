export type BookCommand =
  | { kind: "write"; title: string }
  | { kind: "new"; title: string; premise: string };

export function parseBookCommand(reply: string): BookCommand | null {
  for (const line of reply.split(/\r?\n/u)) {
    const write = line.match(/^\s*WRITE:\s*(.+?)\s*$/iu);
    if (write?.[1]?.trim()) return { kind: "write", title: write[1].trim() };

    const create = line.match(/^\s*NEW:\s*(.+?)\s*$/iu);
    if (!create?.[1]) continue;
    const [rawTitle, ...rawPremise] = create[1].split("|");
    const title = rawTitle?.trim() || "";
    if (title) return { kind: "new", title, premise: rawPremise.join("|").trim() };
  }
  return null;
}

export function normalizeBookTitle(title: string): string {
  return title.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}
