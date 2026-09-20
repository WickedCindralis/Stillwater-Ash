export type ClipboardImage = File | string;

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function getClipboardImage(data: DataTransfer): ClipboardImage | null {
  const file = Array.from(data.files).find(isImageFile);
  if (file) return file;

  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const itemFile = item.getAsFile();
    if (itemFile && (isImageFile(itemFile) || item.type.startsWith("image/"))) {
      return itemFile;
    }
  }

  const plainText = data.getData("text/plain").trim();
  if (plainText.startsWith("data:image/")) return plainText;

  const html = data.getData("text/html");
  const dataUrl = html.match(/<img[^>]+src=["'](data:image\/[^"']+)["']/i)?.[1];
  return dataUrl ?? null;
}