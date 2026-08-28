import type { APIRoute } from 'astro';
import { AI_UNAVAILABLE, fail, json, readJson, runtimeEnv } from '../../lib/api';
import { generateJson, hasAi, semanticSimilarity } from '../../lib/ai';
import { ANALYSIS_SYSTEM } from '../../lib/prompts';
import { coerceCV } from '../../lib/cv';
import { cvToPlainText, extractKeywords, scoreCV } from '../../lib/ats';
import type { CV } from '../../lib/types';

export const prerender = false;

interface TailorResult {
  title?: string;
  summary?: string;
  skills?: string[];
  experience?: { company?: string; bullets?: string[] }[];
  notes?: string[];
}

/** Adapt a CV to one specific job ad: rewritten headline, summary, skill order
 *  and bullets — plus a before/after ATS score. */
export const POST: APIRoute = async (context) => {
  const env = runtimeEnv();
  const body = await readJson<{ cv?: unknown; jobText?: string; company?: string; position?: string }>(context.request);
  if (!body) return fail('Невалиден JSON.');

  const jobText = (body.jobText ?? '').trim();
  if (jobText.length < 60) return fail('Постави пълния текст на обявата (поне няколко изречения).', 422);

  const source = coerceCV(body.cv);
  const before = scoreCV(source, jobText);

  if (!hasAi(env)) return json({ before, after: before, cv: source, warning: AI_UNAVAILABLE });

  const keywords = extractKeywords(jobText, 20);

  const result = await generateJson<TailorResult>(
    env,
    [
      'Адаптирай CV-то към обявата. Не измисляй нов опит и нови числа — само преформулирай и подреди наличното така, че да отговаря на изискванията.',
      `Ключови думи от обявата: ${keywords.join(', ')}.`,
      `Липсващи в CV-то в момента: ${before.missingKeywords.join(', ') || 'няма'}.`,
      '',
      'Върни JSON точно в този вид:',
      '{"title":"","summary":"","skills":[""],"experience":[{"company":"","bullets":[""]}],"notes":[""]}',
      '',
      'CV:',
      cvToPlainText(source).slice(0, 6000),
      '',
      'Обява:',
      jobText.slice(0, 4000),
    ].join('\n'),
    ANALYSIS_SYSTEM,
    {},
    1800,
  );

  const tailored: CV = {
    ...source,
    id: `cv_${Math.random().toString(36).slice(2, 10)}`,
    name: body.company ? `${body.company} — ${body.position || source.contact.title}` : `${source.name} (адаптирано)`,
    updatedAt: new Date().toISOString(),
    contact: { ...source.contact, title: result.title?.trim() || source.contact.title },
    summary: result.summary?.trim() || source.summary,
    skills: Array.isArray(result.skills) && result.skills.length
      ? [...new Set(result.skills.map((s) => String(s).trim()).filter(Boolean))].slice(0, 30)
      : source.skills,
    experience: source.experience.map((job) => {
      const match = result.experience?.find(
        (item) => item.company && job.company && item.company.toLowerCase().includes(job.company.toLowerCase().slice(0, 6)),
      );
      const bullets = match?.bullets?.map((b) => String(b).trim()).filter(Boolean);
      return bullets?.length ? { ...job, bullets: bullets.slice(0, 8) } : job;
    }),
    targetJob: { title: body.position || result.title || source.contact.title, company: body.company ?? '', description: jobText },
  };

  const after = scoreCV(tailored, jobText);
  const similarity = await semanticSimilarity(env, cvToPlainText(tailored), jobText);

  return json({
    cv: tailored,
    before,
    after,
    similarity: similarity === null ? null : Math.round(similarity * 100),
    notes: Array.isArray(result.notes) ? result.notes.filter((n) => typeof n === 'string').slice(0, 5) : [],
  });
};
