import type { MangaArchiveJob, MangaArchivePlan, MangaArchiveRequest } from '../../shared/mangaArchive';
import { isMangaChapter } from './manga';
import { API_BASE_URL, requestData } from './http';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
export function isMangaArchiveJob(value: unknown): value is MangaArchiveJob {
  return object(value) && typeof value.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)
    && ['queued', 'downloading', 'ready', 'failed', 'cancelled'].includes(String(value.state)) && typeof value.title === 'string'
    && uint(value.completedChapters) && uint(value.totalChapters) && uint(value.completedPages) && uint(value.bytes) && typeof value.message === 'string'
    && (value.fileUrl === undefined || value.fileUrl === `/api/manga/archives/${value.id}/file`);
}
const isPlan = (value: unknown): value is MangaArchivePlan => object(value) && typeof value.mangaId === 'string' && typeof value.title === 'string'
  && typeof value.language === 'string' && Array.isArray(value.chapters) && value.chapters.every(isMangaChapter) && uint(value.externalChapters)
  && strings(value.groups) && strings(value.warnings) && Array.isArray(value.volumes) && value.volumes.every(volume => object(volume) && (volume.volume === null || typeof volume.volume === 'string') && uint(volume.chapters));
async function mutate(path: string, body: unknown): Promise<MangaArchiveJob> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(object(payload) && typeof payload.message === 'string' ? payload.message : 'Não foi possível preparar o download. Tente novamente.');
  if (!object(payload) || !isMangaArchiveJob(payload.data)) throw new Error('O serviço retornou um download inesperado. Atualize a obra.');
  return payload.data;
}
export const mangaArchiveService = {
  plan: (id: string, language: string) => requestData<MangaArchivePlan>(`/manga/${encodeURIComponent(id)}/archive-plan?${new URLSearchParams({ language })}`, isPlan, { timeoutMs: 65_000 }),
  start: (request: MangaArchiveRequest) => mutate('/manga/archives', request),
  status: (id: string) => requestData<MangaArchiveJob>(`/manga/archives/${encodeURIComponent(id)}`, isMangaArchiveJob),
  cancel: (id: string) => mutate(`/manga/archives/${encodeURIComponent(id)}/cancel`, {}),
  fileUrl: (id: string) => `${API_BASE_URL}/manga/archives/${encodeURIComponent(id)}/file`,
};
