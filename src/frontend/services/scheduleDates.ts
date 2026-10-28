export const DEFAULT_SCHEDULE_TIME_ZONE = 'America/Sao_Paulo';
export const MAX_SCHEDULE_WEEK_OFFSET = 52;
export type SchedulePeriod = 'morning' | 'afternoon' | 'night';

export interface ScheduleDay { key: string; start: number; end: number }
export interface ScheduleWeek { start: number; end: number; days: ScheduleDay[] }

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string) {
  if (!dayFormatters.has(timeZone)) dayFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return dayFormatters.get(timeZone)!;
}

function clockFormatter(timeZone: string) {
  if (!clockFormatters.has(timeZone)) clockFormatters.set(timeZone, new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return clockFormatters.get(timeZone)!;
}

/** The timestamp is in milliseconds; the key represents a civil date in this zone. */
export function scheduleDateKey(timestamp: number, timeZone = DEFAULT_SCHEDULE_TIME_ZONE): string {
  const parts = dayFormatter(timeZone).formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function civilDate(key: string): Date {
  const date = new Date(`${key}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) throw new RangeError('Data do calendário inválida.');
  return date;
}

/** UTC is used only for civil-date arithmetic, never for a zone's day boundary. */
export function addScheduleDays(key: string, days: number): string {
  const date = civilDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatScheduleDate(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(civilDate(key));
}

/** Earliest Unix second of a local date, including midnight DST gaps or repeats. */
export function scheduleDayStart(key: string, timeZone = DEFAULT_SCHEDULE_TIME_ZONE): number {
  const center = Math.floor(civilDate(key).getTime() / 1000);
  let first = center - 36 * 3600;
  let last = center + 36 * 3600;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (scheduleDateKey(middle * 1000, timeZone) < key) first = middle + 1;
    else last = middle;
  }
  return first;
}

/** Monday through Sunday in the selected zone; API boundaries are [start, end). */
export function scheduleWeek(now: number, timeZone = DEFAULT_SCHEDULE_TIME_ZONE, offset = 0): ScheduleWeek {
  const today = scheduleDateKey(now, timeZone);
  const weekday = civilDate(today).getUTCDay();
  const boundedOffset = Math.min(MAX_SCHEDULE_WEEK_OFFSET, Math.max(-MAX_SCHEDULE_WEEK_OFFSET, Math.trunc(offset) || 0));
  const monday = addScheduleDays(today, -((weekday + 6) % 7) + boundedOffset * 7);
  const keys = Array.from({ length: 8 }, (_, index) => addScheduleDays(monday, index));
  const boundaries = keys.map(key => scheduleDayStart(key, timeZone));
  return { start: boundaries[0], end: boundaries[7], days: keys.slice(0, 7).map((key, index) => ({ key, start: boundaries[index], end: boundaries[index + 1] })) };
}

/** Airing timestamps use Unix seconds, matching the schedule API. */
export function scheduleTime(airingAt: number, timeZone = DEFAULT_SCHEDULE_TIME_ZONE): string {
  return clockFormatter(timeZone).format(new Date(airingAt * 1000));
}

export function schedulePeriod(airingAt: number, timeZone = DEFAULT_SCHEDULE_TIME_ZONE): SchedulePeriod {
  const hour = Number(clockFormatter(timeZone).formatToParts(new Date(airingAt * 1000)).find(part => part.type === 'hour')!.value);
  return hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'night';
}
