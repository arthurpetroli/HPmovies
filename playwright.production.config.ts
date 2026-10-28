import { defineConfig } from '@playwright/test';
import { devNull } from 'node:os';
import development from './playwright.config';

// Reuse the existing contracts against compiled files, without Vite or private sources.
const origin = 'http://127.0.0.1:4173';

export default defineConfig({
  ...development,
  testMatch: 'platform.spec.ts',
  use: { ...development.use, baseURL: origin },
  webServer: {
    command: 'node scripts/start-production.cjs',
    url: `${origin}/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      DOTENV_CONFIG_PATH: devNull,
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: '4173',
      HPMOVIES_SOURCE_HOST_PORT: '18099',
      HPMOVIES_EXTENSIONS_FILE: '',
      ANIWATCH_API_REDIS_CONN_URL: '',
      TOKO_ENABLED: 'false',
      TATAKAI_ENABLED: 'false',
      TATAKAI_CONTENT_AUTHORIZED: 'false',
      STREMIO_ADDONS_JSON: '[]',
      AUTOMATIC_SUBTITLES_ENABLED: 'false',
      EXTERNAL_SUBTITLES_ENABLED: 'false',
      ENABLE_LEGACY_HIANIME: 'false',
    },
  },
});
