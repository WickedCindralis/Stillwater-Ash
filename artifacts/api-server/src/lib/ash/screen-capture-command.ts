const SCREEN_CAPTURE_COMMAND = /^\s*\[SCREENSHOT\]\s*$/gim;

export function stripScreenCaptureCommand(reply: string): {
  requested: boolean;
  text: string;
} {
  let requested = false;
  const text = reply.replace(SCREEN_CAPTURE_COMMAND, () => {
    requested = true;
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { requested, text };
}