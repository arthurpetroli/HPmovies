import type { AutomaticSubtitleJob } from '../../shared/providers';
import { API_BASE_URL, apiMediaUrl } from './http';

async function request(path: string, method: 'GET' | 'POST', signal: AbortSignal): Promise<AutomaticSubtitleJob> {
  const response = await fetch(`${API_BASE_URL}/subtitles/automatic/${path}`, {
    method, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  const envelope = await response.json();
  if (!response.ok) throw new Error(typeof envelope?.message === 'string' ? envelope.message : 'Não foi possível gerar a legenda.');
  const data = envelope?.data;
  if (!data || typeof data.id !== 'string' || !['pending', 'complete', 'failed'].includes(data.state)
    || data.state === 'complete' && (!data.subtitle || typeof data.subtitle.id !== 'string' || typeof data.subtitle.url !== 'string'
      || typeof data.subtitle.label !== 'string' || data.subtitle.machineTranslated !== true || !['pt', 'pt-BR'].includes(data.subtitle.language))) throw new Error('Resposta de tradução inválida.');
  return { ...data, ...(data.subtitle ? { subtitle: { ...data.subtitle, url: apiMediaUrl(data.subtitle.url) } } : {}) };
}

export const automaticSubtitleService = {
  start: (token: string, signal: AbortSignal) => request(encodeURIComponent(token), 'POST', signal),
  status: (id: string, signal: AbortSignal) => request(`jobs/${encodeURIComponent(id)}`, 'GET', signal),
};
