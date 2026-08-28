import type { AiEnv } from './ai';
import { generateJson } from './ai';
import { EXTRACT_SYSTEM } from './prompts';
import { coerceCV, emptyCV } from './cv';
import type { CV, FormatFlags } from './types';

const SCHEMA = `{
  "contact": { "name": "", "title": "", "city": "", "email": "", "phone": "", "links": [] },
  "summary": "",
  "experience": [{ "role": "", "company": "", "period": "", "bullets": [""] }],
  "education": [{ "degree": "", "school": "", "period": "" }],
  "skills": [""],
  "languages": [{ "name": "", "level": "" }],
  "certificates": [""]
}`;

/** Heuristics over the raw document text that feed the ATS „формат“ score.
 *  Markdown produced by Workers AI keeps tables, images and column artefacts,
 *  so they are still detectable after conversion. */
export function detectFormatFlags(raw: string): FormatFlags {
  const lines = raw.split('\n');
  const tableLines = lines.filter((line) => (line.match(/\|/g)?.length ?? 0) >= 2).length;
  const words = raw.split(/\s+/).filter(Boolean).length;

  return {
    hasTables: tableLines >= 3,
    hasImages: /!\[[^\]]*\]\(/.test(raw) || /<img\b/i.test(raw),
    hasColumns: lines.filter((line) => /\S {6,}\S/.test(line)).length > lines.length * 0.15,
    hasHeaderFooter: /^\s*(page|стр\.?|страница)\s*\d+/im.test(raw),
    pages: Math.max(1, Math.round(words / 450)),
  };
}

/** Turn a raw CV document into the structured CV the whole app works with. */
export async function structureCV(env: AiEnv, rawText: string, name = 'Качено CV'): Promise<CV> {
  const trimmed = rawText.slice(0, 12000);

  const parsed = await generateJson<Record<string, unknown>>(
    env,
    [
      'Извлечи данните от следната автобиография и ги върни точно по тази JSON схема:',
      SCHEMA,
      '',
      'Автобиография:',
      trimmed,
      '',
      'Върни само JSON.',
    ].join('\n'),
    EXTRACT_SYSTEM,
    {},
    2000,
  );

  const base = emptyCV(name);
  const cv = coerceCV({ ...parsed, id: base.id, name, createdAt: base.createdAt, updatedAt: base.updatedAt });
  cv.sourceFormatFlags = detectFormatFlags(rawText);
  return cv;
}
