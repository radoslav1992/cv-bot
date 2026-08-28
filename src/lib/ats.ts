import type { AtsReport, CV, Finding, ScoreDimensions } from './types';

/** Bulgarian + English stop words, so keyword extraction from a job ad
 *  doesn't reward „и“, „на“, „the“ and friends. */
const STOP = new Set([
  'и', 'или', 'на', 'в', 'във', 'за', 'с', 'със', 'от', 'до', 'по', 'при', 'че', 'да', 'не',
  'се', 'си', 'е', 'са', 'бе', 'би', 'ще', 'като', 'но', 'а', 'то', 'той', 'тя', 'те', 'ние',
  'вие', 'аз', 'ти', 'този', 'тази', 'това', 'тези', 'който', 'която', 'което', 'които',
  'един', 'една', 'едно', 'му', 'ѝ', 'им', 'ни', 'ви', 'ме', 'те', 'го', 'я', 'ги', 'нас',
  'всички', 'всеки', 'също', 'още', 'вече', 'много', 'повече', 'най', 'ако', 'къде', 'кога',
  'нашия', 'нашата', 'нашите', 'търсим', 'предлагаме', 'изисквания', 'отговорности', 'екип',
  'работа', 'компания', 'позиция', 'опит', 'умения', 'ниво', 'години', 'година', 'месец',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'as', 'is', 'are', 'be', 'will', 'you', 'we', 'our', 'your', 'this', 'that', 'it', 'have',
  'has', 'not', 'but', 'they', 'their', 'about', 'into', 'over', 'more', 'than', 'who', 'what',
  'experience', 'skills', 'team', 'work', 'role', 'job', 'years', 'year', 'company', 'looking',
]);

/** Verbs that describe duties rather than achievements — the classic ATS/recruiter red flag. */
const DUTY_PHRASES = [
  'отговорен за', 'отговорна за', 'отговорности', 'задължения', 'участие в',
  'помагах', 'занимавах се с', 'responsible for', 'duties included', 'worked on',
];

const NUMBER_RE = /(\d+([.,]\d+)?\s*(%|лв|eur|usd|k|млн|хил)?)|(\d+)/i;

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}+#.\-\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Trailing dots are punctuation ("C1."), inner ones are part of the term
 *  ("next.js"), so only the edges are trimmed. */
function cleanToken(word: string): string {
  return word.replace(/^[.\-]+|[.\-]+$/g, '');
}

export function tokenise(text: string): string[] {
  return normalise(text)
    .split(' ')
    .map(cleanToken)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Pull the terms an ATS would key on out of a job ad, most frequent first. */
export function extractKeywords(text: string, limit = 24): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenise(text)) counts.set(token, (counts.get(token) ?? 0) + 1);

  // Multi-word technology names ("machine learning", "проектен мениджмънт").
  // Bigrams never cross a sentence or list boundary — otherwise the tail of one
  // requirement glues onto the head of the next ("jest менторство").
  for (const segment of text.split(/[.,;:!?•()\[\]\n\r/|]+/)) {
    const words = normalise(segment).split(' ').map(cleanToken);
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i];
      const b = words[i + 1];
      if (!a || !b || STOP.has(a) || STOP.has(b) || a.length < 3 || b.length < 3) continue;
      if (/^\d+$/.test(a) || /^\d+$/.test(b)) continue;
      const bigram = `${a} ${b}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1.5);
    }
  }

  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([word]) => word)
    .slice(0, limit);
}

export function cvToPlainText(cv: CV): string {
  const parts: string[] = [
    cv.contact.name, cv.contact.title, cv.contact.city, cv.contact.email, cv.contact.phone,
    ...cv.contact.links, cv.summary,
  ];
  for (const job of cv.experience) parts.push(job.role, job.company, job.period, ...job.bullets);
  for (const ed of cv.education) parts.push(ed.degree, ed.school, ed.period, ed.note ?? '');
  for (const pr of cv.projects) parts.push(pr.name, pr.description);
  parts.push(...cv.skills, ...cv.certificates);
  for (const lang of cv.languages) parts.push(lang.name, lang.level);
  return parts.filter(Boolean).join('\n');
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scoreStructure(cv: CV, findings: Finding[]): number {
  let score = 0;
  if (cv.contact.name.trim()) score += 10;
  if (cv.contact.title.trim()) score += 5;
  if (cv.contact.email.trim()) score += 10; else findings.push({ id: 'email', severity: 'bad', points: 10, text: 'Липсва имейл за контакт — ATS няма как да те свърже с кандидатурата.' });
  if (cv.contact.phone.trim()) score += 5; else findings.push({ id: 'phone', severity: 'warn', points: 5, text: 'Добави телефон за контакт.' });
  if (cv.contact.city.trim()) score += 5;
  if (cv.summary.trim().length > 40) score += 15; else findings.push({ id: 'summary', severity: 'warn', points: 15, text: 'Добави кратко обобщение (2–3 изречения) в началото на CV-то.' });
  if (cv.experience.length >= 1) score += 20; else findings.push({ id: 'exp', severity: 'bad', points: 20, text: 'Добави поне една позиция в секция „Опит“.' });
  if (cv.education.length >= 1) score += 10; else findings.push({ id: 'edu', severity: 'warn', points: 10, text: 'Добави образование — повечето ATS системи търсят тази секция.' });
  if (cv.skills.length >= 5) score += 15;
  else findings.push({ id: 'skills', severity: 'warn', points: 15 - Math.min(15, cv.skills.length * 3), text: `Изброй поне 5 умения (сега имаш ${cv.skills.length}).` });
  if (cv.experience.some((job) => job.bullets.length > 0)) score += 5;
  return clamp(score);
}

function scoreKeywords(cv: CV, jobText: string | undefined, findings: Finding[], out: { matched: string[]; missing: string[] }): number {
  const cvText = normalise(cvToPlainText(cv));
  if (!jobText || jobText.trim().length < 40) {
    const base = 40 + Math.min(30, cv.skills.length * 5) + (cv.summary.length > 60 ? 10 : 0) + (cv.contact.title ? 10 : 0);
    findings.push({ id: 'nojob', severity: 'warn', points: 8, text: 'Постави текста на конкретна обява, за да сравним ключовите думи и да вдигнем съвпадението.' });
    return clamp(base);
  }

  const keywords = extractKeywords(jobText);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) (cvText.includes(kw) ? matched : missing).push(kw);
  out.matched = matched;
  out.missing = missing;

  const ratio = keywords.length ? matched.length / keywords.length : 0;

  // The first ~200 words carry the most weight in most parsers.
  const head = normalise([cv.contact.title, cv.summary, cv.skills.join(' ')].join(' '));
  const inHead = keywords.filter((kw) => head.includes(kw)).length;
  const headBonus = keywords.length ? (inHead / keywords.length) * 15 : 0;

  if (missing.length) {
    findings.push({
      id: 'missing-kw',
      severity: missing.length > keywords.length / 2 ? 'bad' : 'warn',
      points: Math.min(18, missing.length * 2),
      text: `Липсват ключови думи от обявата: ${missing.slice(0, 6).join(', ')}.`,
    });
  }
  if (inHead < 3) {
    findings.push({ id: 'head-kw', severity: 'warn', points: 6, text: 'Пренеси 3–4 ключови умения от обявата в заглавието и обобщението.' });
  }

  return clamp(ratio * 85 + headBonus);
}

function scoreImpact(cv: CV, findings: Finding[]): number {
  const bullets = cv.experience.flatMap((job) => job.bullets);
  if (!bullets.length) return 0;
  const withNumbers = bullets.filter((b) => NUMBER_RE.test(b));
  const ratio = withNumbers.length / bullets.length;

  const weakRoles = cv.experience
    .filter((job) => job.bullets.length && !job.bullets.some((b) => NUMBER_RE.test(b)))
    .map((job) => job.company || job.role);

  if (weakRoles.length) {
    findings.push({
      id: 'numbers',
      severity: 'warn',
      points: Math.min(9, weakRoles.length * 5),
      text: `Добави числа към ${weakRoles.length === 1 ? 'позицията' : 'позициите'}: ${weakRoles.slice(0, 3).join(', ')}.`,
    });
  }
  return clamp(20 + ratio * 80);
}

function scoreReadability(cv: CV, findings: Finding[]): number {
  let score = 100;
  const bullets = cv.experience.flatMap((job) => job.bullets);

  const summaryWords = cv.summary.trim().split(/\s+/).filter(Boolean).length;
  if (summaryWords > 70) {
    score -= 12;
    findings.push({ id: 'long-summary', severity: 'warn', points: 4, text: 'Свий обобщението до 3 изречения — дългите въведения се пропускат.' });
  }

  const longBullets = bullets.filter((b) => b.trim().split(/\s+/).length > 32).length;
  if (longBullets) {
    score -= Math.min(20, longBullets * 6);
    findings.push({ id: 'long-bullets', severity: 'warn', points: 4, text: `Съкрати ${longBullets} прекалено дълги описания до едно изречение.` });
  }

  const lower = cvToPlainText(cv).toLowerCase();
  const duties = DUTY_PHRASES.filter((phrase) => lower.includes(phrase));
  if (duties.length) {
    score -= Math.min(18, duties.length * 8);
    findings.push({ id: 'duties', severity: 'warn', points: 6, text: `Замени „${duties[0]}“ с глагол за постижение (постигнах, намалих, стартирах).` });
  }

  if (cv.contact.links.length === 0) score -= 5;
  if (/\b(ул\.|бул\.|ж\.к\.)/i.test(lower)) {
    score -= 4;
    findings.push({ id: 'address', severity: 'warn', points: 2, text: 'Премахни точния адрес, остави само град.' });
  }
  return clamp(score);
}

function scoreFormat(cv: CV, findings: Finding[]): number {
  const flags = cv.sourceFormatFlags;
  let score = 100;
  if (!flags) return score;
  if (flags.hasTables) {
    score -= 25;
    findings.push({ id: 'tables', severity: 'bad', points: 12, text: 'Таблиците не се четат надеждно от ATS — пренеси съдържанието в обикновен текст.' });
  }
  if (flags.hasColumns) {
    score -= 20;
    findings.push({ id: 'columns', severity: 'warn', points: 10, text: 'Двуколонният макет разбърква реда на текста при парсване. Мини на една колона.' });
  }
  if (flags.hasHeaderFooter) {
    score -= 15;
    findings.push({ id: 'header', severity: 'warn', points: 8, text: 'Данните в горния/долния колонтитул често се губят — премести ги в тялото.' });
  }
  if (flags.hasImages) {
    score -= 10;
    findings.push({ id: 'images', severity: 'warn', points: 5, text: 'Изображенията и иконите не носят информация към ATS.' });
  }
  if ((flags.pages ?? 1) > 2) {
    score -= 10;
    findings.push({ id: 'pages', severity: 'warn', points: 5, text: 'CV над 2 страници рядко се чете докрай. Съкрати най-старите позиции.' });
  }
  return clamp(score);
}

const WEIGHTS: Record<keyof ScoreDimensions, number> = {
  structure: 0.25,
  keywords: 0.25,
  impact: 0.25,
  readability: 0.15,
  format: 0.1,
};

export function labelForScore(total: number): string {
  if (total >= 85) return 'Отлична съвместимост';
  if (total >= 70) return 'Добра съвместимост';
  if (total >= 55) return 'Средна съвместимост';
  return 'Слаба съвместимост';
}

/** Deterministic ATS score. Runs without the model so the number is stable,
 *  reproducible and explainable — the model only writes the wording around it. */
export function scoreCV(cv: CV, jobText?: string): AtsReport {
  const findings: Finding[] = [];
  const kw = { matched: [] as string[], missing: [] as string[] };

  const dimensions: ScoreDimensions = {
    structure: scoreStructure(cv, findings),
    keywords: scoreKeywords(cv, jobText ?? cv.targetJob?.description, findings, kw),
    impact: scoreImpact(cv, findings),
    readability: scoreReadability(cv, findings),
    format: scoreFormat(cv, findings),
  };

  const total = clamp(
    (Object.keys(WEIGHTS) as (keyof ScoreDimensions)[])
      .reduce((sum, key) => sum + dimensions[key] * WEIGHTS[key], 0),
  );

  findings.sort((a, b) => b.points - a.points);

  return {
    total,
    dimensions,
    findings: findings.slice(0, 8),
    matchedKeywords: kw.matched,
    missingKeywords: kw.missing,
    label: labelForScore(total),
  };
}
