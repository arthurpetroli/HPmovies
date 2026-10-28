import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCatalogSchedule, scheduleService } from '../src/frontend/services/schedule';

const start = 1792983600, end = start + 7 * 86400;
const schedule = { start, end, items: [{ id: 'fixture-airing-1', airingAt: start + 3600, episode: 0, anime: { id: '21', title: 'Agenda fixture', poster: '', genres: [] } }] };

describe('schedule frontend contract', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends precise Unix-second boundaries and accepts episode zero without inventing media availability', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: schedule })));
    vi.stubGlobal('fetch', fetcher);
    await expect(scheduleService.week(start, end)).resolves.toEqual(schedule);
    const url = new URL(fetcher.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/catalog/schedule');
    expect(url.searchParams.get('start')).toBe(String(start));
    expect(url.searchParams.get('end')).toBe(String(end));
  });

  it.each([
    { ...schedule, items: [null] },
    { ...schedule, items: [{ ...schedule.items[0], airingAt: end }] },
    { ...schedule, items: [{ ...schedule.items[0], anime: null }] },
    { ...schedule, items: [{ ...schedule.items[0], episode: -1 }] },
    { ...schedule, truncated: 'yes' },
    { ...schedule, end: start + 9 * 86400 },
  ])('rejects malformed and out-of-window schedule data', value => expect(isCatalogSchedule(value)).toBe(false));

  it('rejects a response for a different week', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...schedule, start: start - 1 } }))));
    await expect(scheduleService.week(start, end)).rejects.toThrow('dados inesperados');
  });
});
