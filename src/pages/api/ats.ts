import type { APIRoute } from 'astro';
import { fail, json, readJson } from '../../lib/api';
import { coerceCV } from '../../lib/cv';
import { scoreCV } from '../../lib/ats';

export const prerender = false;

/** Deterministic ATS score — no model call, so it is instant and reproducible. */
export const POST: APIRoute = async (context) => {
  const body = await readJson<{ cv?: unknown; jobText?: string }>(context.request);
  if (!body) return fail('Невалиден JSON.');
  const cv = coerceCV(body.cv);
  return json({ report: scoreCV(cv, body.jobText) });
};
