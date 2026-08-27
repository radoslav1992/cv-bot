/** Thin wrapper around the Workers AI binding.
 *  Everything the app generates runs through here — no external AI provider. */

export const DEFAULT_CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const DEFAULT_FAST_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';

/** The slice of the Workers AI binding this app uses. Declared locally so the
 *  project typechecks with DOM types (the client scripts need them) instead of
 *  pulling workerd's globals into every file. */
export interface WorkersAi {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  toMarkdown?(documents: { name: string; blob: Blob }[]): Promise<{ name: string; data?: string }[]>;
}

export interface AiEnv {
  AI?: WorkersAi;
  CVBOT_CHAT_MODEL?: string;
  CVBOT_FAST_MODEL?: string;
  CVBOT_EMBEDDING_MODEL?: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface NormalisedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export class AiUnavailableError extends Error {
  constructor() {
    super('Workers AI binding (AI) is not available in this environment.');
    this.name = 'AiUnavailableError';
  }
}

export function chatModel(env: AiEnv): string {
  return env.CVBOT_CHAT_MODEL || DEFAULT_CHAT_MODEL;
}
export function fastModel(env: AiEnv): string {
  return env.CVBOT_FAST_MODEL || DEFAULT_FAST_MODEL;
}
export function embeddingModel(env: AiEnv): string {
  return env.CVBOT_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

export function hasAi(env: AiEnv | undefined): env is AiEnv & { AI: WorkersAi } {
  return Boolean(env && env.AI && typeof env.AI.run === 'function');
}

interface RunOptions {
  model?: string;
  messages: AiMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

interface RawCompletion {
  response?: string;
  tool_calls?: unknown;
}

/** Workers AI returns tool calls in two shapes depending on the model family.
 *  Flatten both into { id, name, args }. */
export function normaliseToolCalls(raw: unknown): NormalisedToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: NormalisedToolCall[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fn = (record.function ?? record) as Record<string, unknown>;
    const name = typeof fn.name === 'string' ? fn.name : undefined;
    if (!name) continue;

    const rawArgs = fn.arguments ?? fn.parameters ?? {};
    let args: Record<string, unknown> = {};
    if (typeof rawArgs === 'string') {
      try {
        args = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        args = {};
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs as Record<string, unknown>;
    }

    calls.push({
      id: typeof record.id === 'string' ? record.id : `call_${index}`,
      name,
      args,
    });
  }
  return calls;
}

export async function runCompletion(
  env: AiEnv,
  { model, messages, tools, temperature = 0.4, maxTokens = 1200 }: RunOptions,
): Promise<{ text: string; toolCalls: NormalisedToolCall[] }> {
  if (!hasAi(env)) throw new AiUnavailableError();

  const payload: Record<string, unknown> = {
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools?.length) payload.tools = tools;

  const result = (await env.AI.run(model || chatModel(env), payload)) as RawCompletion;

  return {
    text: typeof result?.response === 'string' ? result.response : '',
    toolCalls: normaliseToolCalls(result?.tool_calls),
  };
}

/** Streaming completion. Yields plain text deltas. */
export async function* streamCompletion(
  env: AiEnv,
  { model, messages, temperature = 0.5, maxTokens = 1200 }: RunOptions,
): AsyncGenerator<string> {
  if (!hasAi(env)) throw new AiUnavailableError();

  const stream = (await env.AI.run(model || chatModel(env), {
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  })) as unknown as ReadableStream<Uint8Array>;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineAt: number;
      while ((newlineAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineAt).trim();
        buffer = buffer.slice(newlineAt + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as { response?: string };
          if (parsed.response) yield parsed.response;
        } catch {
          /* partial frame — the next chunk completes it */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Convenience: one-shot text generation with the small, fast model. */
export async function generateText(env: AiEnv, prompt: string, system?: string, maxTokens = 700): Promise<string> {
  const messages: AiMessage[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const { text } = await runCompletion(env, { model: fastModel(env), messages, maxTokens, temperature: 0.5 });
  return text.trim();
}

/** Ask a model for JSON and parse it defensively (models like to wrap in prose). */
export async function generateJson<T>(env: AiEnv, prompt: string, system: string, fallback: T, maxTokens = 900): Promise<T> {
  try {
    const text = await generateText(env, prompt, system, maxTokens);
    return parseLooseJson<T>(text) ?? fallback;
  } catch {
    return fallback;
  }
}

export function parseLooseJson<T>(text: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const candidates = [trimmed];

  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace > 0) candidates.push(trimmed.slice(firstBrace));

  const lastBracket = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (lastBracket > -1 && firstBrace > -1) candidates.push(trimmed.slice(Math.max(firstBrace, 0), lastBracket + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/** Convert an uploaded document (PDF/DOCX/images/HTML) to Markdown with Workers AI. */
export async function documentToMarkdown(env: AiEnv, name: string, blob: Blob): Promise<string> {
  if (!hasAi(env)) throw new AiUnavailableError();
  const { toMarkdown } = env.AI;
  if (typeof toMarkdown !== 'function') throw new AiUnavailableError();

  const results = await toMarkdown.call(env.AI, [{ name, blob }]);
  return results?.[0]?.data ?? '';
}

/** Cosine similarity over Workers AI embeddings — used to rank how close a CV
 *  is to a job ad even when the wording differs. */
export async function semanticSimilarity(env: AiEnv, a: string, b: string): Promise<number | null> {
  if (!hasAi(env)) return null;
  try {
    const result = (await env.AI.run(embeddingModel(env), {
      text: [a.slice(0, 4000), b.slice(0, 4000)],
    })) as { data?: number[][] };
    const [x, y] = result?.data ?? [];
    if (!x || !y || x.length !== y.length) return null;

    let dot = 0;
    let normX = 0;
    let normY = 0;
    for (let i = 0; i < x.length; i++) {
      dot += x[i]! * y[i]!;
      normX += x[i]! * x[i]!;
      normY += y[i]! * y[i]!;
    }
    if (!normX || !normY) return null;
    return dot / (Math.sqrt(normX) * Math.sqrt(normY));
  } catch {
    return null;
  }
}
