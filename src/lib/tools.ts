import type { AiEnv, ToolDefinition } from './ai';
import { generateText, semanticSimilarity } from './ai';
import { COVER_LETTER_SYSTEM, ANALYSIS_SYSTEM } from './prompts';
import { cvToPlainText, extractKeywords, normalise, scoreCV } from './ats';
import type { CV, CVEducation, CVExperience } from './types';

export interface ToolContext {
  env: AiEnv;
  cv: CV;
}

export interface ToolOutcome {
  /** What the model sees as the tool result. */
  result: string;
  /** Short Bulgarian label shown to the user under the bot bubble. */
  label: string;
  /** Mutated CV, when the tool changed the document. */
  cv?: CV;
}

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome> | ToolOutcome;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : fallback;

const strArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => str(v)).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[\n;,•]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const nextId = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

const touch = (cv: CV): CV => ({ ...cv, updatedAt: new Date().toISOString() });

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'set_contact',
      description: 'Записва личните данни на кандидата: име, търсена позиция, град, имейл, телефон, линкове. Извиква се веднага щом потребителят ги съобщи.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Име и фамилия' },
          title: { type: 'string', description: 'Позицията, за която кандидатства, напр. „Frontend Developer“' },
          city: { type: 'string', description: 'Град' },
          email: { type: 'string', description: 'Имейл' },
          phone: { type: 'string', description: 'Телефон' },
          links: { type: 'array', items: { type: 'string' }, description: 'LinkedIn, GitHub, портфолио' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_summary',
      description: 'Записва професионалното обобщение (2–3 изречения) в началото на CV-то.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'Обобщение на български, 2–3 изречения, с ключови умения и години опит' } },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_experience',
      description: 'Добавя (или обновява по компания) позиция в секция „Опит“ заедно с постиженията към нея.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Длъжност' },
          company: { type: 'string', description: 'Компания' },
          period: { type: 'string', description: 'Период, напр. „2022 — сега“' },
          bullets: { type: 'array', items: { type: 'string' }, description: 'Постижения с числа, всяко като отделно изречение' },
        },
        required: ['role', 'company'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_education',
      description: 'Добавя образование или курс.',
      parameters: {
        type: 'object',
        properties: {
          degree: { type: 'string', description: 'Специалност / степен' },
          school: { type: 'string', description: 'Учебно заведение' },
          period: { type: 'string', description: 'Период' },
        },
        required: ['degree', 'school'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_skills',
      description: 'Записва списъка с умения и технологии. Заменя предишния списък.',
      parameters: {
        type: 'object',
        properties: { skills: { type: 'array', items: { type: 'string' }, description: 'Умения и технологии' } },
        required: ['skills'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_language',
      description: 'Добавя владян език и ниво.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Език, напр. „Английски“' },
          level: { type: 'string', description: 'Ниво, напр. „C1“ или „свободно“' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'score_cv',
      description: 'Изчислява ATS резултата на текущото CV и връща конкретни препоръки. Използва се, когато потребителят пита за оценка или след по-голяма промяна.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tailor_to_job',
      description: 'Приема текста на конкретна обява, сравнява я с CV-то и връща липсващи и намерени ключови думи плюс съвпадение в проценти.',
      parameters: {
        type: 'object',
        properties: {
          job_text: { type: 'string', description: 'Пълният текст на обявата' },
          company: { type: 'string', description: 'Компания' },
          position: { type: 'string', description: 'Длъжност от обявата' },
        },
        required: ['job_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_cover_letter',
      description: 'Генерира мотивационно писмо на база текущото CV и целевата обява.',
      parameters: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Компания, до която е писмото' },
          tone: { type: 'string', description: 'Тон: „официален“, „приятелски“ или „кратък“' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'improve_bullets',
      description: 'Пренаписва описанията на дадена позиция така, че да звучат като постижения с измерим резултат.',
      parameters: {
        type: 'object',
        properties: { company: { type: 'string', description: 'Компанията, чиито описания да се пренапишат' } },
        required: [],
      },
    },
  },
];

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  set_contact(args, { cv }) {
    const contact = { ...cv.contact };
    if (str(args.name)) contact.name = str(args.name);
    if (str(args.title)) contact.title = str(args.title);
    if (str(args.city)) contact.city = str(args.city);
    if (str(args.email)) contact.email = str(args.email);
    if (str(args.phone)) contact.phone = str(args.phone);
    const links = strArray(args.links);
    if (links.length) contact.links = [...new Set([...contact.links, ...links])];

    return {
      result: `Данните са записани: ${JSON.stringify(contact)}`,
      label: 'Записах личните данни',
      cv: touch({ ...cv, contact }),
    };
  },

  set_summary(args, { cv }) {
    const summary = str(args.summary);
    if (!summary) return { result: 'Празно обобщение — не е записано.', label: 'Пропуснато обобщение' };
    return { result: 'Обобщението е записано.', label: 'Обнових обобщението', cv: touch({ ...cv, summary }) };
  },

  add_experience(args, { cv }) {
    const company = str(args.company);
    const role = str(args.role);
    if (!company && !role) return { result: 'Липсват компания и длъжност.', label: 'Нужна е повече информация' };

    const bullets = strArray(args.bullets);
    const existingIndex = cv.experience.findIndex(
      (job) => normalise(job.company) === normalise(company) && normalise(company).length > 0,
    );

    const experience = [...cv.experience];
    if (existingIndex >= 0) {
      const current = experience[existingIndex] as CVExperience;
      experience[existingIndex] = {
        ...current,
        role: role || current.role,
        period: str(args.period) || current.period,
        bullets: bullets.length ? [...new Set([...current.bullets, ...bullets])] : current.bullets,
      };
    } else {
      experience.unshift({
        id: nextId('exp'),
        role,
        company,
        period: str(args.period),
        bullets,
      });
    }

    return {
      result: `Позицията е записана. Общо позиции: ${experience.length}.`,
      label: `Добавих ${role || company}`,
      cv: touch({ ...cv, experience }),
    };
  },

  add_education(args, { cv }) {
    const degree = str(args.degree);
    const school = str(args.school);
    if (!degree && !school) return { result: 'Липсват данни за образование.', label: 'Нужна е повече информация' };

    const entry: CVEducation = { id: nextId('edu'), degree, school, period: str(args.period) };
    const exists = cv.education.some(
      (e) => normalise(e.school) === normalise(school) && normalise(e.degree) === normalise(degree),
    );
    const education = exists ? cv.education : [...cv.education, entry];

    return { result: 'Образованието е записано.', label: 'Добавих образование', cv: touch({ ...cv, education }) };
  },

  set_skills(args, { cv }) {
    const skills = strArray(args.skills);
    if (!skills.length) return { result: 'Празен списък с умения.', label: 'Няма нови умения' };
    return {
      result: `Записани умения: ${skills.join(', ')}`,
      label: `Записах ${skills.length} умения`,
      cv: touch({ ...cv, skills: [...new Set(skills)] }),
    };
  },

  add_language(args, { cv }) {
    const name = str(args.name);
    if (!name) return { result: 'Липсва език.', label: 'Нужна е повече информация' };
    const level = str(args.level, '—');
    const languages = cv.languages.filter((l) => normalise(l.name) !== normalise(name));
    languages.push({ name, level });
    return { result: 'Езикът е записан.', label: `Добавих ${name}`, cv: touch({ ...cv, languages }) };
  },

  score_cv(_args, { cv }) {
    const report = scoreCV(cv);
    const top = report.findings.slice(0, 3).map((f) => `+${f.points}: ${f.text}`).join(' | ');
    return {
      result: `ATS резултат: ${report.total}/100 (${report.label}). Структура ${report.dimensions.structure}, ключови думи ${report.dimensions.keywords}, измерими резултати ${report.dimensions.impact}, четимост ${report.dimensions.readability}, формат ${report.dimensions.format}. Препоръки: ${top || 'няма критични'}`,
      label: `Изчислих ATS скор: ${report.total}`,
    };
  },

  async tailor_to_job(args, { cv, env }) {
    const jobText = str(args.job_text);
    if (jobText.length < 30) {
      return { result: 'Текстът на обявата е твърде кратък. Поискай пълния текст.', label: 'Нужен е текстът на обявата' };
    }

    const targetJob = {
      title: str(args.position) || cv.contact.title,
      company: str(args.company),
      description: jobText,
    };
    const updated: CV = touch({ ...cv, targetJob });
    const report = scoreCV(updated, jobText);
    const similarity = await semanticSimilarity(env, cvToPlainText(updated), jobText);
    const keywords = extractKeywords(jobText, 16);

    return {
      result: [
        `Съвпадение с обявата: ${report.total}/100.`,
        similarity !== null ? `Смислово сходство: ${Math.round(similarity * 100)}%.` : '',
        `Ключови думи в обявата: ${keywords.join(', ')}.`,
        `Намерени в CV-то: ${report.matchedKeywords.join(', ') || 'няма'}.`,
        `Липсващи: ${report.missingKeywords.join(', ') || 'няма'}.`,
        'Предложи как да вплетем липсващите естествено, без да лъжем.',
      ]
        .filter(Boolean)
        .join(' '),
      label: `Сравних с обявата: ${report.total}/100`,
      cv: updated,
    };
  },

  async write_cover_letter(args, { cv, env }) {
    const company = str(args.company) || cv.targetJob?.company || '';
    const tone = str(args.tone, 'професионален');

    const prompt = [
      `Напиши мотивационно писмо на български език${company ? ` до ${company}` : ''}. Тон: ${tone}.`,
      '',
      'CV на кандидата:',
      cvToPlainText(cv),
      cv.targetJob?.description ? `\nОбява:\n${cv.targetJob.description.slice(0, 2500)}` : '',
      '',
      'Върни само текста на писмото, без заглавие и без обяснения.',
    ].join('\n');

    const letter = await generateText(env, prompt, COVER_LETTER_SYSTEM, 900);
    if (!letter) return { result: 'Генерирането не успя.', label: 'Писмото не се получи' };

    return {
      result: 'Писмото е готово и е записано в черновите. Кажи на потребителя, че може да го отвори от прегледа.',
      label: 'Написах мотивационно писмо',
      cv: touch({ ...cv, coverLetter: letter }),
    };
  },

  async improve_bullets(args, { cv, env }) {
    const company = str(args.company);
    const target = company
      ? cv.experience.find((job) => normalise(job.company).includes(normalise(company)))
      : cv.experience[0];

    if (!target || !target.bullets.length) {
      return { result: 'Няма описания за пренаписване. Попитай потребителя какво е постигнал.', label: 'Няма какво да пренапиша' };
    }

    const prompt = [
      `Пренапиши описанията по-долу като постижения на български. Всяко започва със силен глагол и съдържа измерим резултат, ако такъв се подразбира от текста. Не измисляй нови числа — ако липсват, остави формулировката без число.`,
      `Позиция: ${target.role} в ${target.company}.`,
      'Описания:',
      ...target.bullets.map((b, i) => `${i + 1}. ${b}`),
      '',
      'Върни само пренаписаните редове, по един на ред, без номерация.',
    ].join('\n');

    const raw = await generateText(env, prompt, ANALYSIS_SYSTEM, 600);
    const bullets = raw
      .split('\n')
      .map((line) => line.replace(/^\s*[-•\d.)]+\s*/, '').trim())
      .filter((line) => line.length > 10);

    if (!bullets.length) return { result: 'Пренаписването не успя.', label: 'Без промяна' };

    const experience = cv.experience.map((job) => (job.id === target.id ? { ...job, bullets } : job));
    return {
      result: `Описанията са обновени: ${bullets.join(' | ')}`,
      label: `Пренаписах описанията за ${target.company}`,
      cv: touch({ ...cv, experience }),
    };
  },
};

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { result: `Няма такъв инструмент: ${name}`, label: 'Непознат инструмент' };
  try {
    return await handler(args, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: `Инструментът върна грешка: ${message}`, label: 'Инструментът не успя' };
  }
}
