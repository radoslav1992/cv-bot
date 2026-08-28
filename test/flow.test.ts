import assert from 'node:assert/strict';
import test from 'node:test';
import { CV_TEMPLATES, findTemplate } from '../src/lib/cvTemplates.ts';
import { flowProgress, isFieldFilled, suggestionsFor, templateGreeting } from '../src/lib/flow.ts';
import { cvFromTemplate, demoCV, emptyCV } from '../src/lib/cv.ts';
import { cvContext } from '../src/lib/prompts.ts';
import type { CV } from '../src/lib/types.ts';

const frontend = findTemplate('frontend')!;

// ------------------------------------------------------------------ catalogue
test('the catalogue is well formed', () => {
  assert.ok(CV_TEMPLATES.length >= 8, 'enough roles to cover the audiences on the landing page');

  const ids = CV_TEMPLATES.map((template) => template.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');

  for (const template of CV_TEMPLATES) {
    assert.ok(template.name.trim(), `${template.id} has a name`);
    assert.ok(template.audience.trim(), `${template.id} says who it is for`);
    assert.ok(template.suggestedSkills.length >= 4, `${template.id} suggests skills`);
    assert.ok(template.achievementHints.length >= 2, `${template.id} shows achievement examples`);
    assert.equal(template.fields.length, 9, `${template.id} walks the same nine steps`);

    const keys = template.fields.map((field) => field.key);
    assert.equal(new Set(keys).size, keys.length, `${template.id} asks each field once`);
    for (const field of template.fields) {
      assert.ok(field.question.trim().length > 10, `${template.id}/${field.key} has a real question`);
      assert.ok(field.section.trim(), `${template.id}/${field.key} has a section label`);
    }
  }
});

test('every template offers a one-tap answer for the skills step', () => {
  for (const template of CV_TEMPLATES) {
    const skills = template.fields.find((field) => field.key === 'skills')!;
    const offered = skills.suggestions ?? [template.suggestedSkills.join(', ')];
    assert.ok(offered.length >= 1, `${template.id} offers a skill set`);
    assert.ok(offered.every((option) => option.includes(',')), `${template.id} offers whole sets, not single skills`);
  }
});

// ------------------------------------------------------------- instantiation
test('starting from a template fills in the position and nothing else', () => {
  const cv = cvFromTemplate(frontend);
  assert.equal(cv.templateId, 'frontend');
  assert.equal(cv.contact.title, 'Frontend Developer');

  // No invented facts about the person.
  assert.equal(cv.contact.name, '');
  assert.equal(cv.summary, '');
  assert.deepEqual(cv.skills, []);
  assert.deepEqual(cv.experience, []);
  assert.deepEqual(cv.education, []);
});

test('a CV without a template has no script', () => {
  assert.equal(flowProgress(emptyCV()), null);
  assert.equal(flowProgress(demoCV()), null);
});

// -------------------------------------------------------------- progression
test('a fresh template starts on question one', () => {
  const progress = flowProgress(cvFromTemplate(frontend))!;
  assert.equal(progress.step, 1);
  assert.equal(progress.total, 9);
  assert.equal(progress.current?.key, 'name');
  assert.equal(progress.label, 'Стъпка 1 от 9');
  assert.equal(progress.section, 'Лични данни');
  assert.equal(progress.done, false);
});

test('answering advances exactly one step', () => {
  const cv = cvFromTemplate(frontend);
  cv.contact.name = 'Мария Петрова';
  const progress = flowProgress(cv)!;
  assert.equal(progress.step, 2);
  assert.equal(progress.current?.key, 'contact');
  assert.equal(progress.label, 'Стъпка 2 от 9');
});

test('the script walks the whole way to a finished CV', () => {
  const cv = cvFromTemplate(frontend);
  const seen: string[] = [];

  const answer: Record<string, (cv: CV) => void> = {
    name: (c) => { c.contact.name = 'Мария Петрова'; },
    contact: (c) => { c.contact.email = 'maria@mail.bg'; c.contact.city = 'София'; },
    currentRole: (c) => { c.experience.push({ id: 'e1', role: 'Frontend Developer', company: 'Ubisoft', period: '2022 — сега', bullets: [] }); },
    achievements: (c) => { c.experience[0]!.bullets.push('Намалих времето за зареждане с 40%.'); },
    previousRole: (c) => { c.experience.push({ id: 'e2', role: 'Junior', company: 'Telerik', period: '2019 — 2022', bullets: [] }); },
    education: (c) => { c.education.push({ id: 'ed1', degree: 'Информатика', school: 'СУ', period: '2015 — 2019' }); },
    skills: (c) => { c.skills = ['React', 'TypeScript', 'Git']; },
    languages: (c) => { c.languages.push({ name: 'Английски', level: 'C1' }); },
    summary: (c) => { c.summary = 'Frontend разработчик с пет години опит в React и TypeScript.'; },
  };

  for (let guard = 0; guard < 20; guard++) {
    const progress = flowProgress(cv)!;
    if (!progress.current) break;
    seen.push(progress.current.key);
    answer[progress.current.key]!(cv);
  }

  assert.deepEqual(seen, ['name', 'contact', 'currentRole', 'achievements', 'previousRole', 'education', 'skills', 'languages', 'summary']);

  const finished = flowProgress(cv)!;
  assert.equal(finished.done, true);
  assert.equal(finished.current, undefined);
  assert.equal(finished.label, 'Готово');
});

test('skipping the optional previous job still finishes the CV', () => {
  const cv = cvFromTemplate(frontend);
  cv.contact.name = 'Мария Петрова';
  cv.contact.email = 'maria@mail.bg';
  cv.experience.push({ id: 'e1', role: 'Dev', company: 'Ubisoft', period: '2022', bullets: ['Ускорих с 40%.'] });
  cv.education.push({ id: 'ed', degree: 'Информатика', school: 'СУ', period: '2019' });
  cv.skills = ['React', 'TypeScript', 'Git'];
  cv.languages.push({ name: 'Английски', level: 'C1' });
  cv.summary = 'Frontend разработчик с пет години опит в React и TypeScript.';

  const progress = flowProgress(cv)!;
  assert.equal(progress.done, true, 'the optional second job does not block completion');
  assert.equal(progress.current?.key, 'previousRole', 'but it is still offered');
});

test('three skills count as answered, two do not', () => {
  const cv = cvFromTemplate(frontend);
  cv.skills = ['React', 'TypeScript'];
  assert.equal(isFieldFilled('skills', cv), false);
  cv.skills.push('Git');
  assert.equal(isFieldFilled('skills', cv), true);
});

// -------------------------------------------------------------- suggestions
test('suggested answers come from the field, then from the template', () => {
  const cv = cvFromTemplate(frontend);
  cv.contact.name = 'Мария Петрова';
  cv.contact.email = 'maria@mail.bg';
  cv.experience.push({ id: 'e1', role: 'Dev', company: 'Ubisoft', period: '2022', bullets: ['Ускорих с 40%.'] });
  cv.education.push({ id: 'ed', degree: 'Информатика', school: 'СУ', period: '2019' });

  const progress = flowProgress(cv)!;
  assert.equal(progress.current?.key, 'previousRole');
  assert.deepEqual(suggestionsFor(progress), ['Не, това е достатъчно', 'Да, ще ти кажа']);

  cv.experience.push({ id: 'e2', role: 'Junior', company: 'Telerik', period: '2019', bullets: [] });
  const atSkills = flowProgress(cv)!;
  assert.equal(atSkills.current?.key, 'skills');
  assert.ok(suggestionsFor(atSkills)[0]?.includes('React'));
});

test('a finished script offers nothing more to tap', () => {
  assert.deepEqual(suggestionsFor(null), []);
});

test('the greeting states the deal and asks the first question', () => {
  const greeting = templateGreeting(frontend);
  assert.ok(greeting.includes('Frontend разработчик'));
  assert.ok(greeting.includes('8 кратки въпроса'), 'counts only the required steps');
  assert.ok(greeting.includes(frontend.fields[0]!.question));
});

// ------------------------------------------------------------ system prompt
test('the system prompt hands the model one question, in order', () => {
  const cv = cvFromTemplate(frontend);
  cv.contact.name = 'Мария Петрова';

  const context = cvContext(cv);
  assert.ok(context.includes('Frontend разработчик'), 'names the template');
  assert.ok(context.includes('Стъпка 2 от 9'));
  assert.ok(context.includes('СЛЕДВАЩ ВЪПРОС'));
  assert.ok(context.includes(frontend.fields[1]!.question));
  assert.ok(context.includes('[ГОТОВО] Лични данни'), 'marks what is already answered');
  assert.ok(context.includes('[ЧАКА]'));
  assert.ok(context.includes('Не измисляш данни'));
});

test('achievement examples reach the model only on the achievements step', () => {
  const cv = cvFromTemplate(frontend);
  cv.contact.name = 'Мария Петрова';
  assert.ok(!cvContext(cv).includes(frontend.achievementHints[0]!), 'not offered on the name step');

  cv.contact.email = 'maria@mail.bg';
  cv.experience.push({ id: 'e1', role: 'Dev', company: 'Ubisoft', period: '2022', bullets: [] });
  const atAchievements = cvContext(cv);
  assert.ok(atAchievements.includes(frontend.achievementHints[0]!));
  assert.ok(atAchievements.includes('НЕ ги записвай като факти'), 'examples are framed as examples');
});

test('a finished template stops asking and moves on', () => {
  const cv = cvFromTemplate(frontend);
  cv.contact.name = 'Мария Петрова';
  cv.contact.email = 'maria@mail.bg';
  cv.experience.push({ id: 'e1', role: 'Dev', company: 'Ubisoft', period: '2022', bullets: ['Ускорих с 40%.'] });
  cv.experience.push({ id: 'e2', role: 'Junior', company: 'Telerik', period: '2019', bullets: [] });
  cv.education.push({ id: 'ed', degree: 'Информатика', school: 'СУ', period: '2019' });
  cv.skills = ['React', 'TypeScript', 'Git'];
  cv.languages.push({ name: 'Английски', level: 'C1' });
  cv.summary = 'Frontend разработчик с пет години опит в React и TypeScript.';

  const context = cvContext(cv);
  assert.ok(context.includes('Всички въпроси са минати'));
  assert.ok(!context.includes('СЛЕДВАЩ ВЪПРОС'));
});

test('a non-template CV keeps the free-form guidance', () => {
  const context = cvContext(emptyCV());
  assert.ok(!context.includes('СЛЕДВАЩ ВЪПРОС'));
  assert.ok(context.includes('Все още липсват'));
});

test('a step with no canned answer offers nothing to tap, not free-form starters', () => {
  const progress = flowProgress(cvFromTemplate(frontend))!;
  assert.equal(progress.current?.key, 'name');
  assert.deepEqual(suggestionsFor(progress), [], 'you simply type your name');
});
