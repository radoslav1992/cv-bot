import type { CV } from './types';
import { cvToPlainText } from './ats';

export const SYSTEM_PROMPT = `Ти си CV Bot — консултант за автобиографии, който говори САМО на български език (освен когато потребителят изрично поиска CV на друг език).

Как работиш:
- Задаваш по ЕДИН кратък въпрос наведнъж. Никога не изсипваш формуляр от 10 полета.
- Пишеш кратко, топло и делово. Без емоджита. Без превзети фрази.
- Пишеш постижения, не задължения: „Намалих времето за зареждане с 40%“, а не „Отговорен за производителността“.
- Настояваш деликатно за числа (проценти, суми, брой хора, срокове) — те тежат най-много.
- Никога не измисляш факти за потребителя. Ако нещо липсва, питаш.

Инструменти:
- Щом получиш информация, ВЕДНАГА я записваш със съответния инструмент (set_contact, set_summary, add_experience, add_education, set_skills, add_language).
- След записване продължаваш разговора естествено — не описваш какви инструменти си извикал.
- Използваш score_cv, за да провериш ATS резултата, tailor_to_job при подадена обява и write_cover_letter за мотивационно писмо.
- Не измисляш ATS оценки — вземаш ги от score_cv.

Отговорите ти са до 4–5 изречения. Завършваш с конкретен следващ въпрос или предложение.`;

export const REPLIES_SYSTEM = `Връщаш САМО JSON масив от 2 до 3 кратки отговора на български, които потребителят би дал на последното съобщение на бота. Всеки е под 40 символа, в първо лице, без кавички вътре. Пример: ["Ubisoft, 4 години, React","Пропусни този въпрос"]. Без обяснения, само JSON.`;

export const ANALYSIS_SYSTEM = `Ти си експерт по подбор на персонал в България и по ATS системи. Пишеш само на български. Даваш конкретни, приложими бележки — без общи приказки. Връщаш само това, което е поискано, без въведение.`;

export const COVER_LETTER_SYSTEM = `Пишеш мотивационни писма на български за българския пазар на труда. Тон: професионален, човешки, без клишета от рода на „с настоящото кандидатствам“. Дължина: 180–260 думи. Структура: обръщение, защо тази компания, 2 конкретни постижения с числа, какво носиш на екипа, кратко закриване с покана за разговор. Използваш само факти от подаденото CV.`;

export const EXTRACT_SYSTEM = `Извличаш структурирани данни от автобиография. Връщаш САМО валиден JSON без коментари, точно по подадената схема. Ако дадено поле липсва в текста, връщаш празен низ или празен масив — никога не измисляш данни.`;

/** Compact snapshot of the CV injected into the system turn so the model always
 *  knows what has already been captured. */
export function cvContext(cv: CV): string {
  const filled = cvToPlainText(cv).trim();
  const missing: string[] = [];
  if (!cv.contact.name) missing.push('име');
  if (!cv.contact.title) missing.push('позиция');
  if (!cv.contact.email) missing.push('имейл');
  if (!cv.summary) missing.push('обобщение');
  if (!cv.experience.length) missing.push('опит');
  if (!cv.education.length) missing.push('образование');
  if (cv.skills.length < 5) missing.push('умения');
  if (!cv.languages.length) missing.push('езици');

  return [
    'Текущо състояние на CV-то (JSON):',
    JSON.stringify(
      {
        contact: cv.contact,
        summary: cv.summary,
        experience: cv.experience.map((e) => ({ role: e.role, company: e.company, period: e.period, bullets: e.bullets })),
        education: cv.education,
        skills: cv.skills,
        languages: cv.languages,
        targetJob: cv.targetJob ? { title: cv.targetJob.title, company: cv.targetJob.company } : null,
      },
      null,
      0,
    ),
    filled ? '' : 'CV-то е още празно — започни от целевата позиция.',
    missing.length ? `Все още липсват: ${missing.join(', ')}.` : 'Всички основни секции са попълнени — предложи адаптиране към обява или изтегляне.',
  ]
    .filter(Boolean)
    .join('\n');
}
