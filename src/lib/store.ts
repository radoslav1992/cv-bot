/** Browser-side persistence. The Worker stays stateless — the whole workspace
 *  lives in localStorage and travels to the API with each request. That keeps a
 *  `wrangler deploy` free of database bindings and keeps CV content on the
 *  user's own device, which is what the privacy copy promises. */
import type { Application, ChatMessage, CV } from './types';
import { demoApplications, demoCV, emptyCV } from './cv';

const KEY = 'cvbot.workspace.v1';

export interface ChatThread {
  id: string;
  title: string;
  cvId: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface User {
  name: string;
  email: string;
  initials: string;
}

export interface Workspace {
  user: User | null;
  plan: 'free' | 'pro';
  analysesUsed: number;
  analysesLimit: number;
  cvs: CV[];
  activeCvId: string;
  applications: Application[];
  threads: ChatThread[];
  activeThreadId: string;
  cookieConsent: 'accepted' | 'essential' | null;
}

function seed(): Workspace {
  const cv = demoCV();
  return {
    user: { name: 'Мария Петрова', email: 'maria@mail.bg', initials: 'МП' },
    plan: 'free',
    analysesUsed: 2,
    analysesLimit: 3,
    cvs: [cv],
    activeCvId: cv.id,
    applications: demoApplications(),
    threads: [
      {
        id: 'thread_demo',
        title: 'Ново CV — Frontend',
        cvId: cv.id,
        updatedAt: new Date().toISOString(),
        messages: [
          {
            role: 'assistant',
            content:
              'Здравей! Аз съм CV Bot. Ще направим CV, което минава през ATS филтрите и звучи като теб.\n\nОт какво да започнем?',
          },
        ],
      },
    ],
    activeThreadId: 'thread_demo',
    cookieConsent: null,
  };
}

let cache: Workspace | null = null;

export function load(): Workspace {
  if (cache) return cache;
  if (typeof localStorage === 'undefined') return (cache = seed());
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return (cache = seed());
    const parsed = JSON.parse(raw) as Partial<Workspace>;
    const base = seed();
    cache = {
      ...base,
      ...parsed,
      cvs: Array.isArray(parsed.cvs) && parsed.cvs.length ? parsed.cvs : base.cvs,
      applications: Array.isArray(parsed.applications) ? parsed.applications : base.applications,
      threads: Array.isArray(parsed.threads) && parsed.threads.length ? parsed.threads : base.threads,
    };
    return cache;
  } catch {
    return (cache = seed());
  }
}

export function save(next: Workspace): Workspace {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the session still works in memory */
  }
  window.dispatchEvent(new CustomEvent('cvbot:change', { detail: next }));
  return next;
}

export function update(mutate: (state: Workspace) => Workspace | void): Workspace {
  const state = structuredClone(load());
  const result = mutate(state) ?? state;
  return save(result);
}

export function reset(): Workspace {
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return save(seed());
}

export function activeCV(state: Workspace = load()): CV {
  return state.cvs.find((cv) => cv.id === state.activeCvId) ?? state.cvs[0] ?? emptyCV();
}

export function activeThread(state: Workspace = load()): ChatThread {
  return state.threads.find((t) => t.id === state.activeThreadId) ?? state.threads[0]!;
}

export function putCV(cv: CV): Workspace {
  return update((state) => {
    const index = state.cvs.findIndex((item) => item.id === cv.id);
    if (index >= 0) state.cvs[index] = cv;
    else state.cvs.unshift(cv);
    state.activeCvId = cv.id;
  });
}

/** Free-plan metering. Client-side only — it is a product guard-rail, not a
 *  security boundary, and the API stays open so a self-hosted deploy works. */
export function analysesLeft(state: Workspace = load()): number {
  if (state.plan === 'pro') return Number.POSITIVE_INFINITY;
  return Math.max(0, state.analysesLimit - state.analysesUsed);
}

export function consumeAnalysis(): void {
  update((state) => {
    if (state.plan !== 'pro') state.analysesUsed += 1;
  });
}

export const LIMIT_MESSAGE =
  'Изчерпа безплатните анализи за този месец. Мини на План Про за неограничени анализи и адаптирания — виж „Цени“.';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function formatDate(iso: string): string {
  const months = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getDate()} ${months[date.getMonth()]}`;
}
