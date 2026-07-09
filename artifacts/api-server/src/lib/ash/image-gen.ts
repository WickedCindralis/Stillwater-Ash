import OpenAI from "openai";
import { logger } from "../logger";

// Image engine — the agent's brain writes its reply plus a hidden
// `IMAGE: <description>` line; this module detects the request, instructs the
// model to emit that line, extracts it, and draws the actual picture.

let _client: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (_client !== undefined) return _client;
  const apiKey = process.env.ASH_OPENAI_API_KEY;
  _client = apiKey ? new OpenAI({ apiKey }) : null;
  if (!apiKey) logger.warn("[image-gen] ASH_OPENAI_API_KEY not set — image generation disabled");
  return _client;
}

// Picture generation is triggered solely by Wicked's explicit "picture mode"
// toggle in the chat composer (carried per-message as `requestImage`).

export const IMAGE_INSTRUCTION = `[PICTURE REQUEST]
Wicked is asking you to make her a picture. Reply naturally in your own voice first (a short line is fine). Then, on the VERY LAST line of your message, output exactly one line that begins with "IMAGE:" followed by a single vivid, detailed visual description of the picture to be drawn — include subject, setting, mood, lighting, and art style.
Rules: output only ONE IMAGE: line; put it last; do NOT mention the IMAGE: line in your prose; do NOT use markdown or quotes around it. Example: IMAGE: a lone black wolf on a moonlit ridge, mist below, dramatic cinematic lighting, dark fantasy oil-painting style.`;

export function maybeAddImageInstruction(userMessage: string, requestImage: boolean): string {
  if (requestImage) {
    return `${userMessage}\n\n${IMAGE_INSTRUCTION}`;
  }
  return userMessage;
}

export function extractImagePrompt(reply: string): { text: string; imagePrompt: string | null } {
  if (!reply) return { text: reply, imagePrompt: null };
  const match = reply.match(/^[ \t>*-]*IMAGE:\s*(.+)$/im);
  if (!match) return { text: reply, imagePrompt: null };
  const imagePrompt = match[1].trim();
  const text = reply.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, imagePrompt: imagePrompt || null };
}

export async function generateImageDataUrl(prompt: string): Promise<string | null> {
  const client = getClient();
  if (!client || !prompt) return null;

  const attempts: Array<{ model: string; useResponseFormat: boolean }> = [
    { model: "gpt-image-1", useResponseFormat: false },
    { model: "dall-e-3", useResponseFormat: true },
  ];

  for (const { model, useResponseFormat } of attempts) {
    try {
      const params: any = { model, prompt, size: "1024x1024", n: 1 };
      if (useResponseFormat) params.response_format = "b64_json";
      const res = await client.images.generate(params);
      const b64 = res.data?.[0]?.b64_json;
      if (b64) {
        logger.info(`[image-gen] Generated image via ${model} (${Math.round(b64.length / 1024)}KB)`);
        return `data:image/png;base64,${b64}`;
      }
    } catch (e) {
      logger.error(`[image-gen] ${model} generation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return null;
}

// Strip the hidden IMAGE: line and (only when picture mode was on) draw the
// picture. Returns display text and an image data URL ("" if none). Never throws.
export async function processImageRequest(opts: {
  requestImage: boolean;
  cleanedReply: string;
}): Promise<{ text: string; imageUrl: string }> {
  const { requestImage, cleanedReply } = opts;
  const { text, imagePrompt } = extractImagePrompt(cleanedReply);
  if (!imagePrompt || !requestImage) {
    return { text, imageUrl: "" };
  }
  try {
    const dataUrl = await generateImageDataUrl(imagePrompt);
    return { text, imageUrl: dataUrl || "" };
  } catch (e) {
    logger.error(`[image-gen] processImageRequest failed: ${e instanceof Error ? e.message : String(e)}`);
    return { text, imageUrl: "" };
  }
}
