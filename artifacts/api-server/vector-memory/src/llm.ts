import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from './config.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: getConfig().anthropicKey });
  return client;
}

export async function complete(system: string, user: string, maxTokens = 2000): Promise<string> {
  const msg = await getClient().messages.create({
    model: getConfig().summarizerModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}

/** Pulls the first JSON array or object out of a model reply, ignoring fences and chatter. */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.search(/[\[{]/);
  if (start === -1) throw new Error('[memory] No JSON found in model reply.');
  const open = cleaned[start];
  const close = open === '[' ? ']' : '}';
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error('[memory] Incomplete JSON in model reply.');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export function todayString(timezone: string, date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
