import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://comparable-robyn-petroli-58d47e57.koyeb.app',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});