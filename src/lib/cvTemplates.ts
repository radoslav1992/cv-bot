/** Ready-made CV templates.
 *
 *  A template does two things:
 *  1. It gives the document its shape up front — target position and section
 *     order — so nobody starts from a blank page.
 *  2. It turns the conversation into a fixed script: an ordered list of fields,
 *     one question each, with suggested answers. The bot asks only for the next
 *     unfilled field and records the answer.
 *
 *  A template never fills in facts about the person. Suggested skills and the
 *  achievement examples are prompts for the reader, offered as tappable
 *  answers — they only enter the CV once the person picks them. The single
 *  pre-filled field is the target position, which the person chose by picking
 *  the template.
 */

export type FieldKey =
  | 'name'
  | 'contact'
  | 'currentRole'
  | 'achievements'
  | 'previousRole'
  | 'education'
  | 'skills'
  | 'languages'
  | 'summary';

export interface TemplateField {
  key: FieldKey;
  /** Shown in the chat header next to the step counter. */
  section: string;
  /** The single question the bot asks for this field. */
  question: string;
  /** Tappable answers. For skills these are whole sets, so one tap is enough. */
  suggestions?: string[];
  /** Answering is not required to finish the CV. */
  optional?: boolean;
}

export interface CvTemplate {
  id: string;
  name: string;
  category: string;
  /** One line on the card: who this is for. */
  audience: string;
  /** Pre-filled into contact.title — the person picked it by picking the card. */
  targetTitle: string;
  /** Offered at the skills step; nothing enters the CV until it is chosen. */
  suggestedSkills: string[];
  /** Shown as examples in the achievements question, never inserted as fact. */
  achievementHints: string[];
  fields: TemplateField[];
}

interface FieldOverrides {
  currentRole?: Partial<TemplateField>;
  achievements?: Partial<TemplateField>;
  previousRole?: Partial<TemplateField>;
  education?: Partial<TemplateField>;
  skills?: Partial<TemplateField>;
}

/** The nine steps every template walks through, with role-specific wording
 *  merged in. Same spine everywhere, so the progress counter means the same
 *  thing whichever template you picked. */
function buildFields(overrides: FieldOverrides = {}): TemplateField[] {
  const base: TemplateField[] = [
    {
      key: 'name',
      section: 'Лични данни',
      question: 'Как се казваш? Име и фамилия са достатъчни.',
    },
    {
      key: 'contact',
      section: 'Лични данни',
      question: 'Имейл, телефон и град за връзка?',
    },
    {
      key: 'currentRole',
      section: 'Опит',
      question: 'Къде работиш сега или последно — компания, длъжност и от кога?',
      suggestions: ['Нямам опит още', 'Пропусни — ще кача старо CV'],
    },
    {
      key: 'achievements',
      section: 'Опит и постижения',
      question: 'Какво постигна там? Едно-две конкретни неща, по възможност с число.',
    },
    {
      key: 'previousRole',
      section: 'Опит',
      question: 'Има ли предишна работа, която да добавим?',
      suggestions: ['Не, това е достатъчно', 'Да, ще ти кажа'],
      optional: true,
    },
    {
      key: 'education',
      section: 'Образование',
      question: 'Какво си учил и къде?',
    },
    {
      key: 'skills',
      section: 'Умения',
      question: 'Кои умения да включим? Избери готов набор или напиши свои.',
    },
    {
      key: 'languages',
      section: 'Езици',
      question: 'Какви езици владееш и на какво ниво?',
      suggestions: ['Български — роден, Английски — B2', 'Български — роден, Английски — C1', 'Само български'],
    },
    {
      key: 'summary',
      section: 'Обобщение',
      question: 'Готово. Да напиша ли обобщението в началото на CV-то?',
      suggestions: ['Да, напиши го', 'Ще го напиша сам'],
    },
  ];

  return base.map((field) => {
    const override = overrides[field.key as keyof FieldOverrides];
    return override ? { ...field, ...override } : field;
  });
}

export const CV_TEMPLATES: CvTemplate[] = [
  {
    id: 'frontend',
    name: 'Frontend разработчик',
    category: 'IT',
    audience: 'Уеб разработчици с React, Vue или Angular',
    targetTitle: 'Frontend Developer',
    suggestedSkills: ['React', 'TypeScript', 'JavaScript', 'HTML', 'CSS', 'Git', 'REST API', 'Next.js'],
    achievementHints: [
      'Намалих времето за зареждане на приложението с 40%.',
      'Изградих компонентна библиотека, използвана от 4 екипа.',
      'Покрих критичните екрани с тестове и свалих багрепортите наполовина.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега като разработчик — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна там? Например: ускорих приложението, изградих компонентна библиотека, менторствах колеги. Числата тежат най-много.',
      },
      skills: {
        question: 'Кой стек да включим? Избери готов набор или напиши своя.',
        suggestions: [
          'React, TypeScript, Next.js, Git, REST API',
          'Vue, JavaScript, CSS, Git, REST API',
          'Angular, TypeScript, RxJS, Git, REST API',
        ],
      },
    }),
  },
  {
    id: 'backend',
    name: 'Backend разработчик',
    category: 'IT',
    audience: 'Сървърна разработка, API и бази данни',
    targetTitle: 'Backend Developer',
    suggestedSkills: ['Node.js', 'Python', 'Java', 'C#', 'SQL', 'Docker', 'REST API', 'Git'],
    achievementHints: [
      'Свалих времето за отговор на API-то от 800 на 120 ms.',
      'Мигрирах монолита към услуги без прекъсване на работата.',
      'Автоматизирах деплоя и намалих ръчната работа с 6 часа седмично.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега като разработчик — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна там? Например: ускори API, мигрира база данни, автоматизира деплой. Кажи ми числата, ако ги помниш.',
      },
      skills: {
        question: 'Кой стек да включим?',
        suggestions: [
          'Node.js, TypeScript, PostgreSQL, Docker, REST API',
          'Java, Spring, SQL, Docker, Git',
          'Python, Django, PostgreSQL, Docker, REST API',
          'C#, .NET, SQL Server, Azure, Git',
        ],
      },
    }),
  },
  {
    id: 'qa',
    name: 'QA инженер',
    category: 'IT',
    audience: 'Ръчно и автоматизирано тестване',
    targetTitle: 'QA Engineer',
    suggestedSkills: ['Ръчно тестване', 'Selenium', 'Playwright', 'SQL', 'Jira', 'Postman', 'API тестване'],
    achievementHints: [
      'Покрих регресията с автотестове и свалих времето за release от 3 дни на 4 часа.',
      'Открих и описах над 200 дефекта за година.',
      'Въведох процес за тестване на API-та преди мърдж.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега като QA — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна там? Например: автоматизира регресия, скъси времето за release, въведе процес. Числата помагат.',
      },
      skills: {
        question: 'Кои инструменти да включим?',
        suggestions: [
          'Ръчно тестване, Jira, Postman, SQL, API тестване',
          'Playwright, TypeScript, CI/CD, Jira, API тестване',
          'Selenium, Java, TestNG, Jira, SQL',
        ],
      },
    }),
  },
  {
    id: 'sales',
    name: 'Търговски представител',
    category: 'Продажби',
    audience: 'Продажби на терен, B2B и работа с клиенти',
    targetTitle: 'Търговски представител',
    suggestedSkills: ['Активни продажби', 'Преговори', 'CRM', 'Работа с клиенти', 'Планиране на посещения', 'Шофьорска книжка B'],
    achievementHints: [
      'Изпълних плана на 118% за 2025 г.',
      'Увеличих оборота в региона с 24% за една година.',
      'Привлякох 32 нови клиента и задържах 95% от старите.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какви резултати постигна? Тук числата решават: изпълнение на план, оборот, брой нови клиенти, задържане.',
      },
      skills: {
        question: 'Кои умения да включим?',
        suggestions: [
          'Активни продажби, Преговори, CRM, Работа с клиенти, Шофьорска книжка B',
          'B2B продажби, Ключови клиенти, Преговори, Прогнозиране, CRM',
          'Телефонни продажби, Обслужване на клиенти, CRM, Работа в екип',
        ],
      },
    }),
  },
  {
    id: 'marketing',
    name: 'Маркетинг специалист',
    category: 'Маркетинг',
    audience: 'Дигитален маркетинг, кампании и съдържание',
    targetTitle: 'Маркетинг специалист',
    suggestedSkills: ['Google Ads', 'Meta Ads', 'SEO', 'Google Analytics', 'Съдържание', 'Имейл маркетинг', 'Canva'],
    achievementHints: [
      'Свалих цената за заявка от 12 на 7 лв. за три месеца.',
      'Вдигнах органичния трафик с 60% за година.',
      'Стартирах имейл канал, който носи 15% от продажбите.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какви резултати постигна? Например: цена за заявка, ръст на трафик, конверсия, приход от канал.',
      },
      skills: {
        question: 'Кои канали и инструменти да включим?',
        suggestions: [
          'Google Ads, Meta Ads, Google Analytics, SEO, Имейл маркетинг',
          'SEO, Съдържание, Google Analytics, WordPress, Copywriting',
          'Социални мрежи, Canva, Съдържание, Инфлуенсъри, Отчетност',
        ],
      },
    }),
  },
  {
    id: 'accountant',
    name: 'Счетоводител',
    category: 'Финанси',
    audience: 'Оперативно и ТРЗ счетоводство',
    targetTitle: 'Счетоводител',
    suggestedSkills: ['Оперативно счетоводство', 'ДДС', 'ТРЗ', 'Годишно приключване', 'Микроинвест', 'Ажур', 'Excel'],
    achievementHints: [
      'Водя счетоводството на 25 фирми без забавени декларации.',
      'Съкратих месечното приключване от 8 на 5 дни.',
      'Преминах две данъчни ревизии без установени нарушения.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега — фирма, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна там? Например: брой обслужвани фирми, срок за приключване, преминати ревизии, въведена автоматизация.',
      },
      skills: {
        question: 'Кои умения и софтуер да включим?',
        suggestions: [
          'Оперативно счетоводство, ДДС, ТРЗ, Годишно приключване, Микроинвест',
          'ТРЗ, Личен състав, Осигуряване, Ажур, Excel',
          'Оперативно счетоводство, ДДС, Интрастат, Ажур, Excel',
        ],
      },
      education: { question: 'Какво си учил и къде? Тук специалността тежи — счетоводство, финанси, икономика.' },
    }),
  },
  {
    id: 'manager',
    name: 'Мениджър екип',
    category: 'Мениджмънт',
    audience: 'Ръководители на екипи и отдели',
    targetTitle: 'Мениджър',
    suggestedSkills: ['Управление на екип', 'Планиране', 'Бюджетиране', 'Наемане и развитие', 'Отчетност', 'Преговори'],
    achievementHints: [
      'Изградих екип от 3 на 12 души за 18 месеца.',
      'Управлявах бюджет от 400 хил. лв. без преразход.',
      'Свалих текучеството от 30% на 9%.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде ръководиш сега — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна като ръководител? Тук важат размер на екипа, бюджет, текучество, изпълнени цели.',
      },
      skills: {
        question: 'Кои управленски умения да включим?',
        suggestions: [
          'Управление на екип, Планиране, Бюджетиране, Наемане, Отчетност',
          'Операции, Процеси, KPI, Бюджет, Управление на екип',
          'Проектно управление, Agile, Стейкхолдъри, Бюджет, Екип',
        ],
      },
    }),
  },
  {
    id: 'hr',
    name: 'HR специалист',
    category: 'HR',
    audience: 'Подбор, ТРЗ и работа с хора',
    targetTitle: 'HR специалист',
    suggestedSkills: ['Подбор', 'Интервюиране', 'Онбординг', 'Трудово право', 'ТРЗ', 'HRIS', 'Обучение'],
    achievementHints: [
      'Затворих 45 позиции за година със среден срок 21 дни.',
      'Въведох онбординг процес и вдигнах задържането на новите с 30%.',
      'Намалих времето за подбор от 40 на 21 дни.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна там? Например: брой затворени позиции, срок за подбор, задържане на новите, въведени процеси.',
      },
      skills: {
        question: 'Кои умения да включим?',
        suggestions: [
          'Подбор, Интервюиране, Онбординг, Трудово право, HRIS',
          'ТРЗ, Личен състав, Трудово право, Осигуряване, Excel',
          'Технически подбор, Sourcing, LinkedIn Recruiter, Интервюиране',
        ],
      },
    }),
  },
  {
    id: 'admin',
    name: 'Офис администратор',
    category: 'Администрация',
    audience: 'Офис работа, документооборот и организация',
    targetTitle: 'Офис администратор',
    suggestedSkills: ['Документооборот', 'Excel', 'Организация', 'Кореспонденция', 'Работа с клиенти', 'Фактуриране'],
    achievementHints: [
      'Организирах архива и съкратих намирането на документ от часове на минути.',
      'Обслужвам офис от 40 души и трима управители.',
      'Въведох електронно завеждане на документите.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега — компания, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна там? Например: организирани процеси, брой обслужвани хора, въведени системи, спестено време.',
      },
      skills: {
        question: 'Кои умения да включим?',
        suggestions: [
          'Документооборот, Excel, Организация, Кореспонденция, Фактуриране',
          'Работа с клиенти, Телефонна централа, Excel, Организация на срещи',
          'Логистика на офиса, Доставчици, Excel, Отчетност',
        ],
      },
    }),
  },
  {
    id: 'student',
    name: 'Първа работа или стаж',
    category: 'Без опит',
    audience: 'Студенти и хора без професионален опит',
    targetTitle: '',
    suggestedSkills: ['Работа в екип', 'Комуникативност', 'Excel', 'Отговорност', 'Бързо учене', 'Организираност'],
    achievementHints: [
      'Водих студентски проект от четирима души до защита с отличен.',
      'Направих курсов проект, който работи и днес.',
      'Организирах събитие за 120 души.',
    ],
    fields: buildFields({
      currentRole: {
        question:
          'Имаш ли стаж, студентска работа, доброволчество или проект, който да опишем? Всичко върши работа за първо CV.',
        suggestions: ['Имах стаж', 'Само проекти от университета', 'Работил съм нещо друго'],
      },
      achievements: {
        question:
          'Какво направи там конкретно? Например: водих проект, организирах събитие, работих с клиенти. Не е нужно да е голямо.',
      },
      education: { question: 'Какво учиш или си учил и къде? Специалност и година на завършване.' },
      skills: {
        question: 'Кои умения да включим? За първа работа личните умения тежат наравно с техническите.',
        suggestions: [
          'Работа в екип, Комуникативност, Отговорност, Бързо учене, Excel',
          'Организираност, Работа с клиенти, Excel, Внимание към детайла',
          'Word, Excel, PowerPoint, Работа в екип, Точност',
        ],
      },
    }),
  },
  {
    id: 'warehouse',
    name: 'Склад и логистика',
    category: 'Производство',
    audience: 'Складови работници, шофьори, оператори',
    targetTitle: 'Складов работник',
    suggestedSkills: ['Работа с мотокар', 'Приемане и експедиция', 'Инвентаризация', 'Складов софтуер', 'Работа в екип'],
    achievementHints: [
      'Обработвам средно 120 поръчки на смяна.',
      'Работих година без грешка при експедиция.',
      'Обучих трима нови колеги.',
    ],
    fields: buildFields({
      currentRole: { question: 'Къде работиш сега — фирма, длъжност и от кога?' },
      achievements: {
        question:
          'Какво постигна там? Например: брой обработени поръчки, точност, без трудови злополуки, обучени колеги.',
      },
      skills: {
        question: 'Кои умения и документи да включим?',
        suggestions: [
          'Работа с мотокар, Приемане и експедиция, Инвентаризация, Работа в екип',
          'Шофьорска книжка C, Товарителници, Маршрути, Точност',
          'Складов софтуер, Комисиониране, Инвентаризация, Работа на смени',
        ],
      },
      education: { question: 'Какво образование имаш? Достатъчно е средно училище и специалност, ако има.' },
    }),
  },
];

export function findTemplate(id: string | undefined): CvTemplate | undefined {
  if (!id) return undefined;
  return CV_TEMPLATES.find((template) => template.id === id);
}

export const TEMPLATE_CATEGORIES = [...new Set(CV_TEMPLATES.map((template) => template.category))];
