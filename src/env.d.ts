/// <reference types="astro/client" />

/** Minimal typing for the Workers runtime module. The adapter marks
 *  `cloudflare:*` imports as external, so they only resolve inside workerd. */
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
