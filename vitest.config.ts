import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Unit tests inject their source clients. A developer's private .env must
    // never enable a live extension or change expected availability here.
    env: { TOKO_ENABLED: 'false', TATAKAI_ENABLED: 'false', TATAKAI_CONTENT_AUTHORIZED: 'false', EXTERNAL_SUBTITLES_ENABLED: 'false', AUTOMATIC_SUBTITLES_ENABLED: 'false', AUTOMATIC_SUBTITLES_OLLAMA_ENABLED: 'false', STREMIO_ADDONS_JSON: '[]',
      ADULT_CONTENT_ENABLED: 'false', ADULT_SITES: '', ADULT_SITES_CONTENT_AUTHORIZED: 'false', ADULT_SITES_ALLOWED_STREAM_DOMAINS: '', HENTAI_API_URL: '', HENTAI_API_KEY: '' },
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
