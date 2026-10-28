import { describe, expect, it } from 'vitest';
import { addScheduleDays, scheduleDateKey, scheduleDayStart, schedulePeriod, scheduleTime, scheduleWeek } from '../src/frontend/services/scheduleDates';

describe('schedule dates in the selected IANA time zone', () => {
  it('uses the local Monday boundary even when the same instant is still Sunday in São Paulo', () => {
    const now = Date.parse('2026-10-26T01:00:00Z');
    const brazil = scheduleWeek(now, 'America/Sao_Paulo');
    const utc = scheduleWeek(now, 'UTC');
    expect(brazil.days.map(day => day.key)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(utc.days[0].key).toBe('2026-10-26');
    expect(new Date(brazil.start * 1000).toISOString()).toBe('2026-10-19T03:00:00.000Z');
  });

  it('covers seven local days across a daylight-saving transition without assuming 24-hour days', () => {
    const week = scheduleWeek(Date.parse('2026-03-08T16:00:00Z'), 'America/New_York');
    expect(week.days[0].key).toBe('2026-03-02');
    expect(week.days[6].end - week.days[6].start).toBe(23 * 3600);
    expect(week.end - week.start).toBe(167 * 3600);
    expect(scheduleDateKey(week.start * 1000, 'America/New_York')).toBe('2026-03-02');
    expect(scheduleDateKey((week.end - 1) * 1000, 'America/New_York')).toBe('2026-03-08');
    expect(scheduleDateKey(week.end * 1000, 'America/New_York')).toBe('2026-03-09');
  });

  it('finds the start of a date whose midnight was skipped in historical São Paulo DST', () => {
    const start = scheduleDayStart('2018-11-04', 'America/Sao_Paulo');
    expect(new Date(start * 1000).toISOString()).toBe('2018-11-04T03:00:00.000Z');
    expect(scheduleTime(start, 'America/Sao_Paulo')).toBe('01:00');
    expect(scheduleDateKey((start - 1) * 1000, 'America/Sao_Paulo')).toBe('2018-11-03');
  });

  it('handles year boundaries and caps browsing to 52 weeks in either direction', () => {
    expect(addScheduleDays('2026-12-31', 1)).toBe('2027-01-01');
    const now = Date.parse('2026-10-28T16:00:00Z');
    expect(scheduleWeek(now, 'UTC', 1000)).toEqual(scheduleWeek(now, 'UTC', 52));
    expect(scheduleWeek(now, 'UTC', -1000)).toEqual(scheduleWeek(now, 'UTC', -52));
    expect(() => addScheduleDays('2026-02-31', 1)).toThrow('Data do calendário inválida.');
  });

  it('converts dates, clocks and day periods together instead of mixing browser and selected zones', () => {
    const airing = Date.parse('2026-10-28T02:30:00Z') / 1000;
    expect(scheduleDateKey(airing * 1000, 'America/Sao_Paulo')).toBe('2026-10-27');
    expect(scheduleTime(airing, 'America/Sao_Paulo')).toBe('23:30');
    expect(schedulePeriod(airing, 'America/Sao_Paulo')).toBe('night');
    expect(scheduleDateKey(airing * 1000, 'Asia/Tokyo')).toBe('2026-10-28');
    expect(scheduleTime(airing, 'Asia/Tokyo')).toBe('11:30');
    expect(schedulePeriod(airing, 'Asia/Tokyo')).toBe('morning');
    expect(schedulePeriod(Date.parse('2026-10-28T12:00:00Z') / 1000, 'UTC')).toBe('afternoon');
  });
});
