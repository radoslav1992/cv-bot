export interface DocTemplate {
  id: 'klasicheski' | 'moderen' | 'kompakten';
  name: string;
  description: string;
  /** Best-fit note shown on the card. */
  fit: string;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: 'klasicheski',
    name: 'Класически',
    description: 'Една колона, ясни заглавия, без графика. Най-безопасният избор пред ATS.',
    fit: 'Банки, институции, корпорации',
  },
  {
    id: 'moderen',
    name: 'Модерен',
    description: 'Същата структура, по-изразителна типография и умения като етикети.',
    fit: 'Продуктови и технологични компании',
  },
  {
    id: 'kompakten',
    name: 'Компактен',
    description: 'По-плътни отстъпки — събира дълъг опит в една страница.',
    fit: 'Над 10 години опит',
  },
];

export interface StarterPrompt {
  title: string;
  audience: string;
  prompt: string;
}

/** Ready-made openers so the chat never starts from a blank page. */
export const STARTERS: StarterPrompt[] = [
  {
    title: 'Първа работа без опит',
    audience: 'Студенти',
    prompt: 'Студент съм и още нямам професионален опит. Помогни ми да направя CV от стажове, проекти и извънкласни дейности.',
  },
  {
    title: 'Смяна на сферата',
    audience: 'Специалисти',
    prompt: 'Искам да сменя сферата си. Помогни ми да преформулирам досегашния опит така, че да звучи релевантно за новата роля.',
  },
  {
    title: 'Технически профил',
    audience: 'IT',
    prompt: 'Разработчик съм. Направи CV, което подрежда стек, проекти и измерими резултати за техническа роля.',
  },
  {
    title: 'Мениджърска роля',
    audience: 'Мениджъри',
    prompt: 'Ръководя екип. Помогни ми да опиша размер на екипа, бюджет и резултати, вместо списък със задължения.',
  },
  {
    title: 'CV на английски',
    audience: 'Международни позиции',
    prompt: 'Направи английска версия на CV-то ми за международна позиция, като запазиш постиженията и числата.',
  },
  {
    title: 'Връщане след пауза',
    audience: 'След прекъсване',
    prompt: 'Имах прекъсване в кариерата. Помогни ми да го обясня кратко и да насоча вниманието към уменията си.',
  },
];
