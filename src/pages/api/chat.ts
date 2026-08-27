import type { APIRoute } from 'astro';
import { AI_UNAVAILABLE, fail, readJson, runtimeEnv } from '../../lib/api';
import { chatModel, hasAi, runCompletion, streamCompletion, parseLooseJson, fastModel, type AiMessage } from '../../lib/ai';
import { REPLIES_SYSTEM, SYSTEM_PROMPT, cvContext } from '../../lib/prompts';
import { TOOL_DEFINITIONS, executeTool } from '../../lib/tools';
import { coerceCV } from '../../lib/cv';
import { scoreCV } from '../../lib/ats';
import type { CV } from '../../lib/types';

export const prerender = false;

interface ChatRequest {
  messages?: { role: string; content: string }[];
  cv?: unknown;
}

const MAX_TOOL_ROUNDS = 3;
const MAX_HISTORY = 16;

const encoder = new TextEncoder();

function frame(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function fallbackReplies(cv: CV): string[] {
  if (!cv.contact.title) return ['Създай CV от нула', 'Анализирай моето CV', 'Адаптирай към обява'];
  if (!cv.experience.length) return ['Разкажи за последната работа', 'Пропусни — качи старо CV'];
  if (!cv.education.length) return ['Образование и езици', 'Адаптирай към обява', 'Готово, изтегли PDF'];
  return ['Виж препоръките', 'Адаптирай към обява', 'Напиши мотивационно писмо'];
}

export const POST: APIRoute = async (context) => {
  const env = runtimeEnv();
  const body = await readJson<ChatRequest>(context.request);
  if (!body) return fail('Невалиден JSON.');

  const history: AiMessage[] = (body.messages ?? [])
    .filter((message) => message && typeof message.content === 'string' && message.content.trim())
    .slice(-MAX_HISTORY)
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content.slice(0, 8000),
    }));

  if (!history.length) return fail('Липсва съобщение.');

  let cv = coerceCV(body.cv);

  if (!hasAi(env)) {
    const offline = [
      { type: 'delta', text: AI_UNAVAILABLE },
      { type: 'replies', items: fallbackReplies(cv) },
      { type: 'done' },
    ]
      .map((event) => `${JSON.stringify(event)}\n`)
      .join('');
    return new Response(offline, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: Record<string, unknown>) => controller.enqueue(frame(event));

      try {
        const messages: AiMessage[] = [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\n${cvContext(cv)}` },
          ...history,
        ];

        const actions: string[] = [];

        // --- Tool rounds: let the model record what it just learned. -------
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const { text, toolCalls } = await runCompletion(env, {
            model: chatModel(env),
            messages,
            tools: TOOL_DEFINITIONS,
            temperature: 0.3,
            maxTokens: 900,
          });

          if (!toolCalls.length) {
            // No tools needed — if the model already answered, use that text.
            if (text.trim()) {
              push({ type: 'delta', text: text.trim() });
              push({ type: 'cv', cv });
              push({ type: 'actions', items: actions });
              await pushReplies(controller, text.trim());
              push({ type: 'done' });
              controller.close();
              return;
            }
            break;
          }

          messages.push({ role: 'assistant', content: text || '' });

          for (const call of toolCalls) {
            const outcome = await executeTool(call.name, call.args, { env, cv });
            if (outcome.cv) cv = outcome.cv;
            actions.push(outcome.label);
            push({ type: 'action', label: outcome.label });
            messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: outcome.result });
          }

          push({ type: 'cv', cv });
          // Refresh the CV snapshot so the next round sees the new state.
          messages[0] = { role: 'system', content: `${SYSTEM_PROMPT}\n\n${cvContext(cv)}` };
        }

        // --- Final answer, streamed token by token. ------------------------
        let full = '';
        for await (const delta of streamCompletion(env, {
          model: chatModel(env),
          messages: [...messages, {
            role: 'system',
            content: 'Отговори на потребителя на български. Не споменавай инструменти или JSON. Максимум 5 изречения, завършващи с конкретен следващ въпрос.',
          }],
          temperature: 0.5,
          maxTokens: 700,
        })) {
          full += delta;
          push({ type: 'delta', text: delta });
        }

        if (!full.trim()) {
          const fallback = 'Записах това. Да продължим ли със следващата секция?';
          full = fallback;
          push({ type: 'delta', text: fallback });
        }

        push({ type: 'cv', cv });
        push({ type: 'score', report: scoreCV(cv) });
        push({ type: 'actions', items: actions });
        await pushReplies(controller, full);
        push({ type: 'done' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        push({ type: 'error', message: `Грешка при генериране: ${message}` });
        push({ type: 'done' });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      async function pushReplies(ctrl: ReadableStreamDefaultController<Uint8Array>, botText: string) {
        let items = fallbackReplies(cv);
        try {
          const { text } = await runCompletion(env, {
            model: fastModel(env),
            messages: [
              { role: 'system', content: REPLIES_SYSTEM },
              { role: 'user', content: `Съобщение на бота:\n${botText.slice(0, 1200)}` },
            ],
            temperature: 0.6,
            maxTokens: 160,
          });
          const parsed = parseLooseJson<string[]>(text);
          if (Array.isArray(parsed)) {
            const cleaned = parsed
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter((item) => item.length > 1 && item.length <= 48)
              .slice(0, 3);
            if (cleaned.length) items = cleaned;
          }
        } catch {
          /* keep the deterministic fallback */
        }
        ctrl.enqueue(frame({ type: 'replies', items }));
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
};
