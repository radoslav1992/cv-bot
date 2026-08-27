import type { Application, CV } from './types';

export function emptyCV(name = 'Ново CV'): CV {
  const now = new Date().toISOString();
  return {
    id: `cv_${Math.random().toString(36).slice(2, 10)}`,
    name,
    lang: 'bg',
    createdAt: now,
    updatedAt: now,
    contact: { name: '', title: '', city: '', email: '', phone: '', links: [] },
    summary: '',
    experience: [],
    education: [],
    skills: [],
    languages: [],
    projects: [],
    certificates: [],
  };
}

/** The worked example from the design handoff — used to seed a fresh browser so
 *  the dashboard, preview and PDF export have something real to show. */
export function demoCV(): CV {
  const now = new Date().toISOString();
  return {
    id: 'cv_demo_frontend',
    name: 'Frontend Developer — основно',
    lang: 'bg',
    createdAt: now,
    updatedAt: now,
    contact: {
      name: 'Мария Петрова',
      title: 'Frontend Developer',
      city: 'София',
      email: 'maria@mail.bg',
      phone: '+359 88 000 0000',
      links: ['linkedin.com/in/mariapetrova'],
    },
    summary:
      'Frontend разработчик с 5 години опит в React и TypeScript. Водила съм миграция на дизайн система, използвана от 4 екипа.',
    experience: [
      {
        id: 'exp_ubisoft',
        role: 'Senior Frontend Developer',
        company: 'Ubisoft',
        period: '2022 — сега',
        bullets: ['Намалих времето за зареждане с 40%.', 'Менторствах 3 юниора.'],
      },
      {
        id: 'exp_telerik',
        role: 'Frontend Developer',
        company: 'Telerik',
        period: '2019 — 2022',
        bullets: ['Разработих 20+ компонента за вътрешна библиотека.'],
      },
    ],
    education: [
      { id: 'edu_su', degree: 'Информатика, бакалавър', school: 'Софийски университет', period: '2015 — 2019' },
    ],
    skills: ['React', 'TypeScript', 'Next.js', 'Testing'],
    languages: [
      { name: 'Български', level: 'роден' },
      { name: 'Английски', level: 'C1' },
    ],
    projects: [],
    certificates: [],
  };
}

export function demoApplications(): Application[] {
  return [
    { id: 'app_1', company: 'Progress', position: 'Senior Frontend', status: 'interview', date: '2026-08-21', cvId: 'cv_demo_frontend' },
    { id: 'app_2', company: 'Chaos Group', position: 'React Developer', status: 'interview', date: '2026-08-19' },
    { id: 'app_3', company: 'Payhawk', position: 'Frontend Engineer', status: 'waiting', date: '2026-08-18' },
    { id: 'app_4', company: 'Ocado Technology', position: 'Frontend Developer', status: 'waiting', date: '2026-08-15' },
    { id: 'app_5', company: 'SumUp', position: 'Web Engineer', status: 'sent', date: '2026-08-12' },
    { id: 'app_6', company: 'Docler', position: 'Frontend Developer', status: 'rejected', date: '2026-08-04' },
  ];
}

export const STATUS_LABELS: Record<Application['status'], string> = {
  draft: 'Чернова',
  sent: 'Изпратена',
  waiting: 'Чака отговор',
  interview: 'Интервю',
  offer: 'Оферта',
  rejected: 'Отказ',
};

/** Guards a CV that arrived from the browser: everything the scorer touches
 *  must exist and have the right shape. */
export function coerceCV(input: unknown): CV {
  const base = emptyCV();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Record<string, any>;

  const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

  return {
    ...base,
    id: asString(raw.id, base.id),
    name: asString(raw.name, base.name),
    lang: raw.lang === 'en' ? 'en' : 'bg',
    createdAt: asString(raw.createdAt, base.createdAt),
    updatedAt: asString(raw.updatedAt, base.updatedAt),
    contact: {
      name: asString(raw.contact?.name),
      title: asString(raw.contact?.title),
      city: asString(raw.contact?.city),
      email: asString(raw.contact?.email),
      phone: asString(raw.contact?.phone),
      links: asStringArray(raw.contact?.links),
    },
    summary: asString(raw.summary),
    experience: Array.isArray(raw.experience)
      ? raw.experience.slice(0, 20).map((job: any, i: number) => ({
          id: asString(job?.id, `exp_${i}`),
          role: asString(job?.role),
          company: asString(job?.company),
          period: asString(job?.period),
          location: asString(job?.location) || undefined,
          bullets: asStringArray(job?.bullets).slice(0, 12),
        }))
      : [],
    education: Array.isArray(raw.education)
      ? raw.education.slice(0, 10).map((ed: any, i: number) => ({
          id: asString(ed?.id, `edu_${i}`),
          degree: asString(ed?.degree),
          school: asString(ed?.school),
          period: asString(ed?.period),
          note: asString(ed?.note) || undefined,
        }))
      : [],
    skills: asStringArray(raw.skills).slice(0, 40),
    languages: Array.isArray(raw.languages)
      ? raw.languages.slice(0, 10).map((l: any) => ({ name: asString(l?.name), level: asString(l?.level) }))
      : [],
    projects: Array.isArray(raw.projects)
      ? raw.projects.slice(0, 10).map((p: any, i: number) => ({
          id: asString(p?.id, `pr_${i}`),
          name: asString(p?.name),
          description: asString(p?.description),
          link: asString(p?.link) || undefined,
        }))
      : [],
    certificates: asStringArray(raw.certificates).slice(0, 20),
    targetJob: raw.targetJob
      ? {
          title: asString(raw.targetJob.title),
          company: asString(raw.targetJob.company),
          description: asString(raw.targetJob.description).slice(0, 12000),
        }
      : undefined,
    coverLetter: asString(raw.coverLetter) || undefined,
    sourceFormatFlags: raw.sourceFormatFlags && typeof raw.sourceFormatFlags === 'object' ? raw.sourceFormatFlags : undefined,
  };
}
