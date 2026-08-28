/** Thin wrapper around the Workers AI binding.
 *  Everything the app generates runs through here — no external AI provider.
 *
 *  Two request dialects live behind one interface:
 *  - `chat`      — the `@cf/…` models: { messages } in, { response, tool_calls } out.
 *  - `responses` — Cloudflare's partner catalogue (openai/…, and the gpt-oss
 *                  builds): the OpenAI Responses API, { instructions, input } in,
 *                  { output_text, output[] } out.
 *  Callers always speak `messages`; `toRequest`/`readCompletion` translate. */

export const DEFAULT_CHAT_MODEL = 'openai/gpt-5.6-luna';
export const DEFAULT_FAST_MODEL = 'openai/gpt-5.6-luna';
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
  /** Every model is overridable per environment — see wrangler.jsonc `vars`. */
  CVBOT_CHAT_MODEL?: string;
  CVBOT_FAST_MODEL?: string;
  CVBOT_EMBEDDING_MODEL?: string;
  /** 'auto' (default), 'chat' or 'responses' — escape hatch if a model's API
   *  shape is not what `dialectFor` guesses from its id. */
  CVBOT_MODEL_DIALECT?: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  /** On a `tool` turn: which call this is the result of. */
  tool_call_id?: string;
  /** On an `assistant` turn: the calls it made. Echoed back so the model sees
   *  its own calls next to their results — the Responses API requires it. */
  toolCalls?: NormalisedToolCall[];
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

export type Dialect = 'chat' | 'responses';

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

/** Which API a model speaks, from its id. `@cf/…` models are chat-completions;
 *  the partner catalogue and the gpt-oss builds are Responses API. */
export function dialectFor(model: string, env: AiEnv = {}): Dialect {
  const override = env.CVBOT_MODEL_DIALECT?.trim().toLowerCase();
  if (override === 'chat' || override === 'responses') return override;
  if (/gpt-oss/i.test(model)) return 'responses';
  if (/^@cf\//i.test(model)) return 'chat';
  // openai/…, anthropic/…, google/… — Cloudflare's partner models.
  return /^[a-z0-9-]+\//i.test(model) ? 'responses' : 'chat';
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

/** Tool calls come back in three shapes across the two dialects. Flatten all of
 *  them into { id, name, args }. */
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

    const id = record.call_id ?? record.id;
    calls.push({ id: typeof id === 'string' ? id : `call_${index}`, name, args });
  }
  return calls;
}

/** Responses API: pull the assistant text and any function calls out of
 *  `output[]`, falling back to the `output_text` convenience field. */
function readResponsesOutput(result: Record<string, unknown>): { text: string; toolCalls: NormalisedToolCall[] } {
  const chunks: string[] = [];
  const rawCalls: unknown[] = [];

  const output = Array.isArray(result.output) ? result.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;

    if (entry.type === 'function_call') {
      rawCalls.push(entry);
      continue;
    }
    // `message` items (and anything else carrying content) hold the text parts.
    const content = Array.isArray(entry.content) ? entry.content : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const piece = part as Record<string, unknown>;
      if (typeof piece.text === 'string' && piece.type !== 'refusal') chunks.push(piece.text);
    }
  }

  const text = chunks.join('').trim() || (typeof result.output_text === 'string' ? result.output_text : '');
  return { text, toolCalls: normaliseToolCalls(rawCalls) };
}

/** Build the provider payload for whichever dialect the model speaks. */
export function toRequest(
  dialect: Dialect,
  { messages, tools, temperature, maxTokens }: Required<Pick<RunOptions, 'messages'>> & Omit<RunOptions, 'messages' | 'model'>,
  stream = false,
): Record<string, unknown> {
  if (dialect === 'chat') {
    const payload: Record<string, unknown> = {
      messages: messages.map((message) => {
        const turn: Record<string, unknown> = { role: message.role, content: message.content };
        if (message.name) turn.name = message.name;
        if (message.tool_call_id) turn.tool_call_id = message.tool_call_id;
        if (message.toolCalls?.length) {
          turn.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          }));
        }
        return turn;
      }),
      max_tokens: maxTokens,
    };
    if (typeof temperature === 'number') payload.temperature = temperature;
    if (tools?.length) payload.tools = tools;
    if (stream) payload.stream = true;
    return payload;
  }

  // Responses API: system turns become `instructions`, the rest becomes `input`.
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id ?? message.name ?? 'call_0',
        output: message.content,
      });
      continue;
    }

    if (message.content.trim()) input.push({ role: message.role, content: message.content });

    for (const call of message.toolCalls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args),
      });
    }
  }

  const payload: Record<string, unknown> = { input, max_output_tokens: maxTokens };
  if (instructions) payload.instructions = instructions;
  // Reasoning-era models reject `temperature`, so it is deliberately omitted here.
  if (tools?.length) {
    payload.tools = tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  }
  if (stream) payload.stream = true;
  return payload;
}

/** Read a non-streamed completion from either dialect. */
export function readCompletion(raw: unknown): { text: string; toolCalls: NormalisedToolCall[] } {
  if (!raw || typeof raw !== 'object') return { text: '', toolCalls: [] };
  const result = raw as Record<string, unknown>;

  // Chat completions (Workers AI native shape).
  if (typeof result.response === 'string' || result.tool_calls !== undefined) {
    return {
      text: typeof result.response === 'string' ? result.response : '',
      toolCalls: normaliseToolCalls(result.tool_calls),
    };
  }

  // Responses API.
  if (result.output !== undefined || typeof result.output_text === 'string') {
    return readResponsesOutput(result);
  }

  // OpenAI-compatible chat shape, in case a model is routed that way.
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
  if (message) {
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls: normaliseToolCalls(message.tool_calls),
    };
  }

  return { text: '', toolCalls: [] };
}

export async function runCompletion(
  env: AiEnv,
  { model, messages, tools, temperature = 0.4, maxTokens = 1200 }: RunOptions,
): Promise<{ text: string; toolCalls: NormalisedToolCall[] }> {
  if (!hasAi(env)) throw new AiUnavailableError();

  const target = model || chatModel(env);
  const payload = toRequest(dialectFor(target, env), { messages, tools, temperature, maxTokens });
  return readCompletion(await env.AI.run(target, payload));
}

/** Pull the text delta out of one streamed SSE frame, whichever dialect it is. */
export function deltaFromFrame(frame: unknown): string {
  if (!frame || typeof frame !== 'object') return '';
  const event = frame as Record<string, unknown>;

  // Workers AI chat streaming.
  if (typeof event.response === 'string') return event.response;

  // Responses API: response.output_text.delta
  if (typeof event.type === 'string' && event.type.endsWith('.delta')) {
    if (typeof event.delta === 'string') return event.type.includes('output_text') ? event.delta : '';
  }

  // OpenAI-compatible chat streaming.
  const choices = Array.isArray(event.choices) ? event.choices : [];
  const delta = (choices[0] as Record<string, unknown> | undefined)?.delta as Record<string, unknown> | undefined;
  if (delta && typeof delta.content === 'string') return delta.content;

  return '';
}

/** Streaming completion. Yields plain text deltas. */
export async function* streamCompletion(
  env: AiEnv,
  { model, messages, temperature = 0.5, maxTokens = 1200 }: RunOptions,
): AsyncGenerator<string> {
  if (!hasAi(env)) throw new AiUnavailableError();

  const target = model || chatModel(env);
  const payload = toRequest(dialectFor(target, env), { messages, temperature, maxTokens }, true);
  const stream = (await env.AI.run(target, payload)) as unknown as ReadableStream<Uint8Array>;

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
          const delta = deltaFromFrame(JSON.parse(data));
          if (delta) yield delta;
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
