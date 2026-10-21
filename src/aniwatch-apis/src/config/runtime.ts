import 'dotenv/config';

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('Configuração numérica da API inválida. Confira o .env.example.');
  return parsed;
}

function serviceUrl(value: string | undefined, fallback: string): string {
  const url = new URL(value?.trim() || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('A URL do serviço deve usar HTTP(S), sem credenciais ou parâmetros.');
  }
  return url.href.replace(/\/$/, '');
}

export const runtimeConfig = {
  port: integer(process.env.BACKEND_PORT ?? process.env.PORT ?? process.env.ANIWATCH_API_PORT, 4000, 1, 65535),
  host: process.env.BACKEND_HOST ?? process.env.HOST ?? '127.0.0.1',
  anilistUrl: serviceUrl(process.env.ANILIST_GRAPHQL_URL, 'https://graphql.anilist.co'),
  mangadexUrl: serviceUrl(process.env.MANGADEX_API_URL, 'https://api.mangadex.org'),
  allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => new URL(value.trim()).origin),
  rateLimit: integer(process.env.API_RATE_LIMIT, 180, 1, 10000),
  mediaRateLimit: integer(process.env.MEDIA_RATE_LIMIT, 600, 1, 10000),
  rateWindowMs: integer(process.env.API_RATE_WINDOW_MS, 60000, 1000, 3600000),
};
