import assert from 'node:assert/strict';
import test from 'node:test';
import { extractKeywords, scoreCV, tokenise } from '../src/lib/ats.ts';
import { coerceCV, demoCV, emptyCV } from '../src/lib/cv.ts';

const JOB = `Търсим Senior Frontend Developer с опит в React, TypeScript и Next.js.
Изисквания: 5+ години опит, работа с GraphQL, тестове с Jest, менторство на екип, English C1.
Предлагаме работа в София.`;

test('tokenise drops stop words and bare numbers', () => {
  const tokens = tokenise('Ние търсим разработчик с 5 години опит в React');
  assert.ok(tokens.includes('разработчик'));
  assert.ok(tokens.includes('react'));
  assert.ok(!tokens.includes('ние'));
  assert.ok(!tokens.includes('5'));
});

test('keywords keep inner dots but never cross a sentence boundary', () => {
  const keywords = extractKeywords(JOB, 30);
  assert.ok(keywords.includes('next.js'), 'inner dots survive');
  assert.ok(!keywords.some((k) => k.endsWith('.')), 'no trailing punctuation');
  assert.ok(!keywords.includes('jest менторство'), 'bigrams stop at commas');
  assert.ok(keywords.includes('frontend developer'), 'real bigrams survive');
});

test('an empty CV scores low and names what is missing', () => {
  const report = scoreCV(emptyCV());
  assert.ok(report.total < 35, `expected a low score, got ${report.total}`);
  const ids = report.findings.map((f) => f.id);
  for (const id of ['email', 'exp', 'summary']) assert.ok(ids.includes(id), `missing finding: ${id}`);
});

test('the worked example scores well and stays stable', () => {
  const first = scoreCV(demoCV());
  const second = scoreCV(demoCV());
  assert.equal(first.total, second.total, 'scoring is deterministic');
  assert.ok(first.total >= 70, `expected a good score, got ${first.total}`);
  assert.equal(first.label, 'Отлична съвместимост');
});

test('a job ad splits keywords into matched and missing', () => {
  const report = scoreCV(demoCV(), JOB);
  assert.ok(report.matchedKeywords.includes('react'));
  assert.ok(report.missingKeywords.includes('graphql'));
  assert.ok(report.findings.some((f) => f.id === 'missing-kw'));
});

test('bullets without numbers cost impact points', () => {
  const withNumbers = demoCV();
  const withoutNumbers = demoCV();
  withoutNumbers.experience = withoutNumbers.experience.map((job) => ({
    ...job,
    bullets: job.bullets.map((b) => b.replace(/\d+%?/g, 'много')),
  }));
  assert.ok(scoreCV(withNumbers).dimensions.impact > scoreCV(withoutNumbers).dimensions.impact);
});

test('format flags from an uploaded document lower the format score', () => {
  const cv = demoCV();
  cv.sourceFormatFlags = { hasTables: true, hasColumns: true, pages: 3 };
  const report = scoreCV(cv);
  assert.ok(report.dimensions.format < 60);
  assert.ok(report.findings.some((f) => f.id === 'tables'));
});

test('coerceCV survives hostile input from the browser', () => {
  const cv = coerceCV({
    contact: { name: 42, links: ['ok', 7] },
    experience: [{ role: 'Dev', bullets: 'not an array' }],
    skills: ['a', null],
    summary: undefined,
  });
  assert.equal(cv.contact.name, '');
  assert.deepEqual(cv.contact.links, ['ok']);
  assert.deepEqual(cv.experience[0]?.bullets, []);
  assert.deepEqual(cv.skills, ['a']);
  assert.equal(cv.summary, '');
  assert.doesNotThrow(() => scoreCV(cv));
});

test('coerceCV rejects non-objects', () => {
  assert.equal(coerceCV(null).summary, '');
  assert.equal(coerceCV('nope').experience.length, 0);
});
