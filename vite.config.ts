import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.DEV_API_PROXY_URL || `http://127.0.0.1:${env.BACKEND_PORT || env.PORT || 4000}`,
          changeOrigin: true,
        },
      },
    },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  };
});
