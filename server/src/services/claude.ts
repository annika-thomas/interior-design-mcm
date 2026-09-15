import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from '../config.js';

let client: Anthropic | null = null;

export function getClient(): Anthropic | null {
  if (!config.hasClaude) return null;
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

export interface ImagePart {
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  base64: string;
  label: string;
}

/**
 * One structured call to Claude with optional images attached.
 *
 * Returns null rather than throwing when no API key is configured, so every
 * caller can fall back to the deterministic analyzer without special-casing.
 */
export async function structured<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  images?: ImagePart[];
  maxTokens?: number;
}): Promise<z.infer<T> | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of opts.images ?? []) {
    content.push({ type: 'text', text: `Image: ${img.label}` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    });
  }
  content.push({ type: 'text', text: opts.prompt });

  const response = await anthropic.messages.parse({
    model: config.model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Claude declined to analyze this content${
        response.stop_details ? ` (${response.stop_details.category})` : ''
      }.`,
    );
  }
  return (response.parsed_output as z.infer<T> | null) ?? null;
}

/** Map an upload's MIME type onto one the vision API accepts. */
export function visionMediaType(mime: string): ImagePart['mediaType'] | null {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'image/jpeg';
    case 'image/png':
      return 'image/png';
    case 'image/gif':
      return 'image/gif';
    case 'image/webp':
      return 'image/webp';
    default:
      return null;
  }
}
