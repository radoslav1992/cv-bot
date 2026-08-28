import type { APIRoute } from 'astro';
import { AI_UNAVAILABLE, fail, json, runtimeEnv } from '../../lib/api';
import { documentToMarkdown, hasAi } from '../../lib/ai';
import { structureCV, detectFormatFlags } from '../../lib/extract';
import { scoreCV } from '../../lib/ats';

export const prerender = false;

const MAX_BYTES = 8 * 1024 * 1024;
const PLAIN_TEXT = /\.(txt|md|markdown|csv|json)$/i;

/** Upload an existing CV (PDF, DOCX, TXT, MD, image) or paste its text.
 *  Returns a structured CV plus an immediate ATS report. */
export const POST: APIRoute = async (context) => {
  const env = runtimeEnv();
  const contentType = context.request.headers.get('content-type') ?? '';

  let rawText = '';
  let documentName = 'Качено CV';

  if (contentType.includes('multipart/form-data')) {
    const form = await context.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('Липсва файл.');
    if (file.size > MAX_BYTES) return fail('Файлът е над 8 MB. Качи по-малък файл или постави текста.');

    documentName = file.name.replace(/\.[^.]+$/, '') || documentName;

    if (PLAIN_TEXT.test(file.name) || file.type.startsWith('text/')) {
      rawText = await file.text();
    } else {
      if (!hasAi(env)) return fail(AI_UNAVAILABLE, 503);
      try {
        rawText = await documentToMarkdown(env, file.name, file);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(`Файлът не можа да бъде прочетен: ${message}`, 422);
      }
    }
  } else {
    const body = (await context.request.json().catch(() => null)) as { text?: string; name?: string } | null;
    if (!body?.text) return fail('Липсва текст.');
    rawText = body.text;
    if (body.name) documentName = body.name;
  }

  rawText = rawText.trim();
  if (rawText.length < 60) return fail('Текстът е твърде кратък, за да бъде анализиран.', 422);

  if (!hasAi(env)) {
    return json({
      rawText,
      formatFlags: detectFormatFlags(rawText),
      warning: AI_UNAVAILABLE,
    });
  }

  const cv = await structureCV(env, rawText, documentName);
  return json({ cv, report: scoreCV(cv), rawText: rawText.slice(0, 20000) });
};
