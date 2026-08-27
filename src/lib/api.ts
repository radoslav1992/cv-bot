import { env as workerEnv } from 'cloudflare:workers';
import type { AiEnv } from './ai';

/** Bindings and vars for the running Worker. Astro v7 removed
 *  `locals.runtime.env`; `cloudflare:workers` is the supported entry point. */
export function runtimeEnv(): AiEnv {
  return (workerEnv ?? {}) as unknown as AiEnv;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Message shown whenever the Workers AI binding is missing (e.g. `astro dev`
 *  without Cloudflare credentials). Keeps the UI honest instead of silently
 *  pretending the model answered. */
export const AI_UNAVAILABLE =
  'Workers AI не е свързан в тази среда. Изпълни `npx wrangler login` и стартирай `npm run preview`, или деплойни с `npm run deploy` — тогава моделите се активират.';
