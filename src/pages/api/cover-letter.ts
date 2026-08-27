import type { APIRoute } from 'astro';
import { AI_UNAVAILABLE, fail, json, readJson, runtimeEnv } from '../../lib/api';
import { generateText, hasAi } from '../../lib/ai';
import { COVER_LETTER_SYSTEM } from '../../lib/prompts';
import { coerceCV } from '../../lib/cv';
import { cvToPlainText } from '../../lib/ats';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = runtimeEnv();
  const body = await readJson<{ cv?: unknown; company?: string; jobText?: string; tone?: string }>(context.request);
  if (!body) return fail('Невалиден JSON.');
  if (!hasAi(env)) return fail(AI_UNAVAILABLE, 503);

  const cv = coerceCV(body.cv);
  if (!cv.contact.name && !cv.experience.length) return fail('CV-то е празно — първо попълни поне име и една позиция.', 422);

  const company = (body.company ?? cv.targetJob?.company ?? '').trim();
  const jobText = (body.jobText ?? cv.targetJob?.description ?? '').trim();
  const tone = (body.tone ?? 'професионален').trim();

  const prompt = [
    `Напиши мотивационно писмо на български${company ? ` до ${company}` : ''}. Тон: ${tone}.`,
    '',
    'CV на кандидата:',
    cvToPlainText(cv).slice(0, 6000),
    jobText ? `\nОбява:\n${jobText.slice(0, 3000)}` : '',
    '',
    'Върни само текста на писмото.',
  ].join('\n');

  try {
    const letter = await generateText(env, prompt, COVER_LETTER_SYSTEM, 1000);
    if (!letter) return fail('Моделът не върна текст. Опитай отново.', 502);
    return json({ letter });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Генерирането не успя: ${message}`, 502);
  }
};
