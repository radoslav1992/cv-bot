import type { APIRoute } from 'astro';
import { AI_UNAVAILABLE, fail, json, readJson, runtimeEnv } from '../../lib/api';
import { generateText, hasAi } from '../../lib/ai';
import { ANALYSIS_SYSTEM } from '../../lib/prompts';
import { coerceCV } from '../../lib/cv';
import { cvToPlainText, scoreCV } from '../../lib/ats';

export const prerender = false;

/** Full analysis: deterministic score + a written review from the model. */
export const POST: APIRoute = async (context) => {
  const env = runtimeEnv();
  const body = await readJson<{ cv?: unknown; jobText?: string }>(context.request);
  if (!body) return fail('Невалиден JSON.');

  const cv = coerceCV(body.cv);
  const report = scoreCV(cv, body.jobText);

  if (!hasAi(env)) return json({ report, review: '', warning: AI_UNAVAILABLE });

  const prompt = [
    'Прегледай следното CV и напиши кратък анализ на български в три части:',
    '„Какво работи“ (2 изречения), „Какво да поправиш“ (3 булета с конкретни редакции), „Следваща стъпка“ (1 изречение).',
    '',
    `Изчислен ATS резултат: ${report.total}/100 — структура ${report.dimensions.structure}, ключови думи ${report.dimensions.keywords}, измерими резултати ${report.dimensions.impact}, четимост ${report.dimensions.readability}, формат ${report.dimensions.format}.`,
    report.missingKeywords.length ? `Липсващи ключови думи: ${report.missingKeywords.slice(0, 10).join(', ')}.` : '',
    '',
    'CV:',
    cvToPlainText(cv).slice(0, 6000),
    body.jobText ? `\nОбява:\n${body.jobText.slice(0, 3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const review = await generateText(env, prompt, ANALYSIS_SYSTEM, 900);
    return json({ report, review });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ report, review: '', warning: `Анализът от модела не успя: ${message}` });
  }
};
