import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Unit tests inject their source clients. A developer's private .env must
    // never enable a live extension or change expected availability here.
    env: { TOKO_ENABLED: 'false', TATAKAI_ENABLED: 'false', TATAKAI_CONTENT_AUTHORIZED: 'false', STREMIO_ADDONS_JSON: '[]' },
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
