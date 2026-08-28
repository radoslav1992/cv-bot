import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseToolCalls, parseLooseJson, runCompletion, streamCompletion, semanticSimilarity, type AiEnv, type WorkersAi } from '../src/lib/ai.ts';
import { executeTool } from '../src/lib/tools.ts';
import { detectFormatFlags, structureCV } from '../src/lib/extract.ts';
import { demoCV, emptyCV } from '../src/lib/cv.ts';

/** Stand-in for the Workers AI binding. */
function fakeAi(handler: (model: string, input: Record<string, unknown>) => unknown): AiEnv {
  const ai: WorkersAi = { run: async (model, input) => handler(model, input) };
  return { AI: ai };
}

test('tool calls are normalised from both Workers AI shapes', () => {
  const cloudflareShape = normaliseToolCalls([{ name: 'set_summary', arguments: { summary: 'текст' } }]);
  assert.deepEqual(cloudflareShape, [{ id: 'call_0', name: 'set_summary', args: { summary: 'текст' } }]);

  const openAiShape = normaliseToolCalls([
    { id: 'c1', type: 'function', function: { name: 'set_skills', arguments: '{"skills":["React"]}' } },
  ]);
  assert.deepEqual(openAiShape, [{ id: 'c1', name: 'set_skills', args: { skills: ['React'] } }]);
});

test('malformed tool calls are dropped rather than thrown', () => {
  assert.deepEqual(normaliseToolCalls('nonsense'), []);
  assert.deepEqual(normaliseToolCalls([null, { arguments: {} }]), []);
  assert.deepEqual(normaliseToolCalls([{ name: 'x', arguments: '{broken' }]), [{ id: 'call_0', name: 'x', args: {} }]);
});

test('JSON is recovered even when the model wraps it in prose', () => {
  assert.deepEqual(parseLooseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLooseJson('Ето отговора: ["едно","две"]'), ['едно', 'две']);
  assert.equal(parseLooseJson('без json тук'), null);
});

test('runCompletion passes tools through and returns text plus calls', async () => {
  let seen: Record<string, unknown> = {};
  const env = fakeAi((_model, input) => {
    seen = input;
    return { response: 'Здравей', tool_calls: [{ name: 'score_cv', arguments: {} }] };
  });

  const result = await runCompletion(env, {
    messages: [{ role: 'user', content: 'здравей' }],
    tools: [{ type: 'function', function: { name: 'score_cv', description: '', parameters: {} } }],
  });

  assert.equal(result.text, 'Здравей');
  assert.equal(result.toolCalls[0]?.name, 'score_cv');
  assert.ok(Array.isArray(seen.tools));
});

test('streamCompletion parses SSE frames, including split ones', async () => {
  const frames = ['data: {"response":"Здра"}\n', 'data: {"response":"вей"}\n', 'data: [DO', 'NE]\n'];
  const env = fakeAi(() =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
  );

  let text = '';
  for await (const delta of streamCompletion(env, { messages: [{ role: 'user', content: 'x' }] })) text += delta;
  assert.equal(text, 'Здравей');
});

test('a missing binding is reported, never faked', async () => {
  await assert.rejects(() => runCompletion({}, { messages: [{ role: 'user', content: 'x' }] }), /not available/);
  assert.equal(await semanticSimilarity({}, 'a', 'b'), null);
});

test('semanticSimilarity is 1 for identical embeddings and 0 for orthogonal ones', async () => {
  const same = fakeAi(() => ({ data: [[1, 0, 0], [1, 0, 0]] }));
  const orthogonal = fakeAi(() => ({ data: [[1, 0, 0], [0, 1, 0]] }));
  assert.equal(Math.round((await semanticSimilarity(same, 'a', 'b'))! * 100), 100);
  assert.equal(Math.round((await semanticSimilarity(orthogonal, 'a', 'b'))! * 100), 0);
});

test('set_contact merges into the CV without dropping known fields', async () => {
  const cv = emptyCV();
  const outcome = await executeTool('set_contact', { name: 'Иван Иванов', email: 'ivan@mail.bg' }, { env: {}, cv });
  assert.equal(outcome.cv?.contact.name, 'Иван Иванов');
  assert.equal(outcome.cv?.contact.email, 'ivan@mail.bg');
  assert.equal(cv.contact.name, '', 'the input CV is not mutated');
});

test('add_experience updates an existing employer instead of duplicating it', async () => {
  const cv = demoCV();
  const outcome = await executeTool(
    'add_experience',
    { role: 'Lead Frontend', company: 'Ubisoft', bullets: ['Стартирах дизайн система.'] },
    { env: {}, cv },
  );
  assert.equal(outcome.cv?.experience.length, cv.experience.length);
  const ubisoft = outcome.cv?.experience.find((job) => job.company === 'Ubisoft');
  assert.equal(ubisoft?.role, 'Lead Frontend');
  assert.equal(ubisoft?.bullets.length, 3);
});

test('bullets arrive as an array or as free text', async () => {
  const outcome = await executeTool(
    'add_experience',
    { role: 'QA', company: 'Acme', bullets: 'Първо постижение; Второ постижение' },
    { env: {}, cv: emptyCV() },
  );
  assert.deepEqual(outcome.cv?.experience[0]?.bullets, ['Първо постижение', 'Второ постижение']);
});

test('score_cv reports the deterministic score to the model', async () => {
  const outcome = await executeTool('score_cv', {}, { env: {}, cv: demoCV() });
  assert.match(outcome.result, /ATS резултат: \d+\/100/);
  assert.equal(outcome.cv, undefined, 'scoring does not change the document');
});

test('tailor_to_job stores the ad and reports the keyword gap', async () => {
  const outcome = await executeTool(
    'tailor_to_job',
    { job_text: 'Търсим Frontend Developer с GraphQL и Jest. Работа в София, 5 години опит.', company: 'Progress' },
    { env: {}, cv: demoCV() },
  );
  assert.equal(outcome.cv?.targetJob?.company, 'Progress');
  assert.match(outcome.result, /Липсващи/);
});

test('tailor_to_job refuses a job ad that is too short to compare', async () => {
  const outcome = await executeTool('tailor_to_job', { job_text: 'кратко' }, { env: {}, cv: demoCV() });
  assert.equal(outcome.cv, undefined);
  assert.match(outcome.result, /твърде кратък/);
});

test('write_cover_letter stores what the model returned', async () => {
  const env = fakeAi(() => ({ response: 'Уважаеми колеги, ...' }));
  const outcome = await executeTool('write_cover_letter', { company: 'Progress' }, { env, cv: demoCV() });
  assert.equal(outcome.cv?.coverLetter, 'Уважаеми колеги, ...');
});

test('a throwing tool degrades to a message instead of a 500', async () => {
  const env = fakeAi(() => { throw new Error('модел недостъпен'); });
  const outcome = await executeTool('write_cover_letter', {}, { env, cv: demoCV() });
  assert.match(outcome.result, /грешка/);
  assert.equal(outcome.cv, undefined);
});

test('an unknown tool name is answered, not thrown', async () => {
  const outcome = await executeTool('no_such_tool', {}, { env: {}, cv: emptyCV() });
  assert.match(outcome.result, /Няма такъв инструмент/);
});

test('format flags are detected in converted markdown', () => {
  const markdown = ['| Име | Опит |', '| --- | --- |', '| Мария | 5 г. |', '![снимка](data:image/png;base64,xx)'].join('\n');
  const flags = detectFormatFlags(markdown);
  assert.equal(flags.hasTables, true);
  assert.equal(flags.hasImages, true);
});

test('structureCV maps model output onto the CV shape', async () => {
  const env = fakeAi(() => ({
    response: JSON.stringify({
      contact: { name: 'Мария Петрова', title: 'Frontend Developer', email: 'maria@mail.bg' },
      summary: 'Пет години опит.',
      experience: [{ role: 'Dev', company: 'Ubisoft', period: '2022 — сега', bullets: ['Ускорих с 40%.'] }],
      skills: ['React'],
    }),
  }));

  const cv = await structureCV(env, 'x'.repeat(200), 'Моето CV');
  assert.equal(cv.name, 'Моето CV');
  assert.equal(cv.contact.name, 'Мария Петрова');
  assert.equal(cv.experience[0]?.company, 'Ubisoft');
  assert.ok(cv.sourceFormatFlags, 'format flags come from the raw document');
});

test('structureCV returns an empty document when the model answers with junk', async () => {
  const env = fakeAi(() => ({ response: 'съжалявам, не мога' }));
  const cv = await structureCV(env, 'x'.repeat(200));
  assert.equal(cv.contact.name, '');
  assert.equal(cv.experience.length, 0);
});
