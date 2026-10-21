import 'dotenv/config';
import type { StremioAddonConfig } from '../providers/stremio.js';

/** Operator-only configuration; no endpoint accepts addon origins from the browser. */
export function configuredStremioAddons(raw = process.env.STREMIO_ADDONS_JSON || '[]'): StremioAddonConfig[] {
  if (raw.length > 32000) throw new Error('STREMIO_ADDONS_JSON excede o limite de configuração.');
  let result: unknown;
  try { result = JSON.parse(raw); } catch { throw new Error('STREMIO_ADDONS_JSON deve ser uma lista JSON de addons.'); }
  if (!Array.isArray(result)) throw new Error('STREMIO_ADDONS_JSON deve ser uma lista JSON de addons.');
  // The adapter validates every field before making a request.
  return result as StremioAddonConfig[];
}
