import type { CatalogSchedule } from '../../shared/providers';
import { isCatalogAnime } from './catalog';
import { requestData } from './http';

export function isCatalogSchedule(value: unknown): value is CatalogSchedule {
  if (!value || typeof value !== 'object') return false;
  const schedule = value as CatalogSchedule;
  return Number.isSafeInteger(schedule.start) && Number.isSafeInteger(schedule.end) && schedule.end > schedule.start
    && schedule.end - schedule.start <= 8 * 86400 && Array.isArray(schedule.items)
    && (schedule.truncated === undefined || typeof schedule.truncated === 'boolean')
    && schedule.items.every(item => !!item && typeof item.id === 'string' && item.id.length > 0
      && Number.isSafeInteger(item.airingAt) && item.airingAt >= schedule.start && item.airingAt < schedule.end
      && Number.isFinite(item.episode) && item.episode >= 0 && isCatalogAnime(item.anime));
}

export const scheduleService = {
  week: (start: number, end: number) => requestData(`/catalog/schedule?${new URLSearchParams({ start: String(start), end: String(end) })}`,
    (value): value is CatalogSchedule => isCatalogSchedule(value) && value.start === start && value.end === end),
};
