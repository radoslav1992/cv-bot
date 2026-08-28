// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// CV Bot — Astro app deployed as a Cloudflare Worker.
// All AI work runs on Workers AI through the `AI` binding (see wrangler.jsonc).
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Workers AI is a remote-only binding. Prerendering the marketing and legal
    // pages in Node keeps `astro build` working without Cloudflare credentials;
    // the AI binding is only ever touched from SSR routes at runtime.
    prerenderEnvironment: 'node',
    // The app ships no bitmap assets, so skip the Cloudflare Images binding.
    imageService: 'passthrough',
  }),
  // No KV namespace needed — the workspace lives in the browser.
  session: false,
  devToolbar: { enabled: false },
  build: { format: 'file' },
});
