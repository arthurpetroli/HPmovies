import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Film, Moon, Play, RefreshCw, Search, SearchX, Sun, Sunrise } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { AnimeAiring } from '../../shared/providers';
import { AnimeWatchLink } from '../components/anime/AnimeWatchLink';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { scheduleService } from '../services/schedule';
import { DEFAULT_SCHEDULE_TIME_ZONE, MAX_SCHEDULE_WEEK_OFFSET, formatScheduleDate, scheduleDateKey, schedulePeriod, scheduleTime, scheduleWeek } from '../services/scheduleDates';
import type { SchedulePeriod } from '../services/scheduleDates';
import '../schedule.css';

const zones = [
  { id: 'America/Sao_Paulo', label: 'São Paulo (UTC−3)' },
  { id: 'Asia/Tokyo', label: 'Tóquio (UTC+9)' },
  { id: 'UTC', label: 'UTC' },
];
const periods = [
  { id: 'morning' as const, label: 'Manhã', hours: '06h–12h', icon: Sunrise },
  { id: 'afternoon' as const, label: 'Tarde', hours: '12h–18h', icon: Sun },
  { id: 'night' as const, label: 'Noite', hours: '18h–06h', icon: Moon },
];
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

function ScheduleCard({ item, timeZone, now }: { item: AnimeAiring; timeZone: string; now: number }) {
  const [failedPoster, setFailedPoster] = useState('');
  const upcoming = item.airingAt * 1000 > now;
  return <li className="schedule-event"><AnimeWatchLink anime={item.anime} episodeNumber={item.episode} className="schedule-card" aria-label={`${item.anime.title}, episódio ${item.episode}, ${scheduleTime(item.airingAt, timeZone)}`}>
    <span className="schedule-event-clock"><Clock3 size={13} aria-hidden="true" /><time dateTime={new Date(item.airingAt * 1000).toISOString()}>{scheduleTime(item.airingAt, timeZone)}</time></span>
    <span className="schedule-poster" aria-hidden="true">{item.anime.poster && failedPoster !== item.anime.poster ? <img src={item.anime.poster} alt="" loading="lazy" onError={() => setFailedPoster(item.anime.poster)} /> : <Film size={25} />}</span>
    <div className="schedule-event-copy"><h4>{item.anime.title}</h4><span>Episódio {item.episode}</span><small className={upcoming ? 'is-upcoming' : ''}>{upcoming ? 'Planejado' : 'Exibição iniciada'}</small></div>
    <Play size={17} className="schedule-event-play" aria-hidden="true" />
  </AnimeWatchLink></li>;
}

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<'all' | 'planned' | 'aired'>('all');
  const [search, setSearch] = useState('');
  const [failedBackdrop, setFailedBackdrop] = useState('');
  const requestedZone = params.get('tz');
  const timeZone = zones.some(zone => zone.id === requestedZone) ? requestedZone! : DEFAULT_SCHEDULE_TIME_ZONE;
  const weekOffset = Math.min(MAX_SCHEDULE_WEEK_OFFSET, Math.max(-MAX_SCHEDULE_WEEK_OFFSET, Math.trunc(Number(params.get('week'))) || 0));
  const week = useMemo(() => scheduleWeek(now, timeZone, weekOffset), [now, timeZone, weekOffset]);
  const today = scheduleDateKey(now, timeZone);
  const selectedDay = week.days.find(day => day.key === params.get('day'))
    || week.days.find(day => weekOffset === 0 && day.key === today) || week.days[0];
  const loader = useCallback(() => scheduleService.week(week.start, week.end), [week.start, week.end]);
  const { data, loading, error } = useCatalogRequest(`schedule:${week.start}:${week.end}:${retry}`, loader);
  const query = searchable(search.trim());
  const items = useMemo(() => (data?.items || []).filter(item =>
    (!query || searchable(`${item.anime.title} ${item.anime.titleOriginal || ''}`).includes(query))
    && (filter === 'all' || (filter === 'planned' ? item.airingAt * 1000 > now : item.airingAt * 1000 <= now)))
    .sort((first, second) => first.airingAt - second.airingAt || first.anime.title.localeCompare(second.anime.title, 'pt-BR')), [data, query, filter, now]);
  const dayItems = items.filter(item => item.airingAt >= selectedDay.start && item.airingAt < selectedDay.end);
  const grouped: Record<SchedulePeriod, AnimeAiring[]> = { morning: [], afternoon: [], night: [] };
  dayItems.forEach(item => grouped[schedulePeriod(item.airingAt, timeZone)].push(item));
  const background = (dayItems[0] || data?.items[0])?.anime;
  const backdrop = background?.banner || background?.poster;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const changeWeek = (offset: number) => setParams(current => {
    const next = new URLSearchParams(current);
    if (offset) next.set('week', String(offset)); else next.delete('week');
    next.delete('day');
    return next;
  });
  const chooseDay = (key: string) => setParams(current => { const next = new URLSearchParams(current); next.set('day', key); return next; });
  const clearFilters = () => { setFilter('all'); setSearch(''); };
  const dayLabel = formatScheduleDate(selectedDay.key, { weekday: 'long', day: 'numeric', month: 'long' });

  return <main id="main-content" className="schedule-page">
    {backdrop && failedBackdrop !== backdrop && <div className="schedule-backdrop" aria-hidden="true"><img src={backdrop} alt="" onError={() => setFailedBackdrop(backdrop)} /></div>}
    <div className="schedule-content">
      <header className="schedule-header"><div><div className="schedule-title"><CalendarDays size={29} aria-hidden="true" /><h1>Calendário de lançamentos</h1></div><p>Sua semana de anime, no seu horário.</p></div><label className="schedule-zone"><span>Fuso horário</span><select aria-label="Fuso horário da agenda" value={timeZone} onChange={event => setParams(current => { const next = new URLSearchParams(current); next.set('tz', event.target.value); next.delete('day'); return next; })}>{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</select></label></header>
      <div className="schedule-week-toolbar"><div className="schedule-week-navigation"><button type="button" aria-label="Semana anterior" disabled={weekOffset <= -MAX_SCHEDULE_WEEK_OFFSET} onClick={() => changeWeek(weekOffset - 1)}><ChevronLeft size={20} aria-hidden="true" /></button><p aria-live="polite">{formatScheduleDate(week.days[0].key, { day: 'numeric', month: 'short' })}<span>–</span>{formatScheduleDate(week.days[6].key, { day: 'numeric', month: 'short', year: 'numeric' })}</p><button type="button" aria-label="Próxima semana" disabled={weekOffset >= MAX_SCHEDULE_WEEK_OFFSET} onClick={() => changeWeek(weekOffset + 1)}><ChevronRight size={20} aria-hidden="true" /></button></div><button className="schedule-current-week" type="button" disabled={weekOffset === 0 && selectedDay.key === today} onClick={() => changeWeek(0)}>Esta semana</button></div>
      <div className="schedule-filters"><div className="schedule-status-filters" role="group" aria-label="Filtrar estreias">{([{ id: 'all', label: 'Todos' }, { id: 'planned', label: 'Planejados' }, { id: 'aired', label: 'Já lançados' }] as const).map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><label className="schedule-search"><Search size={17} aria-hidden="true" /><input type="search" value={search} placeholder="Buscar anime na agenda" aria-label="Buscar anime na agenda" onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="schedule-body"><nav className="schedule-days" aria-label="Dias da semana">{week.days.map(day => {
        const count = items.filter(item => item.airingAt >= day.start && item.airingAt < day.end).length;
        const isToday = day.key === today;
        return <button type="button" key={day.key} aria-pressed={selectedDay.key === day.key} aria-label={`${formatScheduleDate(day.key, { weekday: 'long', day: 'numeric', month: 'long' })}, ${loading ? 'carregando estreias' : `${count} ${count === 1 ? 'estreia' : 'estreias'}`}${isToday ? ', hoje' : ''}`} onClick={() => chooseDay(day.key)}><span className="schedule-day-date">{formatScheduleDate(day.key, { day: '2-digit' })}</span><span className="schedule-day-copy"><strong>{formatScheduleDate(day.key, { weekday: 'long' })}</strong><small>{isToday ? 'Hoje' : formatScheduleDate(day.key, { month: 'short' })}</small></span><span className="schedule-day-count">{loading ? '—' : count}</span></button>;
      })}</nav><section className="schedule-agenda" aria-label={`Agenda de ${dayLabel}`} aria-busy={loading}>
        <header className="schedule-agenda-heading"><h2>{dayLabel}</h2><span>{loading ? 'Consultando horários…' : `${dayItems.length} ${dayItems.length === 1 ? 'estreia' : 'estreias'}`}</span></header>
        {!loading && data?.truncated && <p className="schedule-notice" role="status">Esta semana tem mais estreias do que o catálogo conseguiu listar. Alguns horários podem não aparecer.</p>}
        {loading ? <div className="schedule-skeletons" aria-label="Carregando estreias">{Array.from({ length: 6 }, (_, index) => <div className="schedule-card-skeleton" key={index}><div className="skeleton" /><span><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /></span></div>)}</div>
          : error ? <div className="schedule-empty" role="alert"><CalendarDays size={34} aria-hidden="true" /><h3>Não foi possível carregar a agenda</h3><p>{error}</p><button className="button-primary" type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Tentar novamente</button></div>
            : dayItems.length ? <>{periods.map(period => grouped[period.id].length > 0 && <section className="schedule-period" aria-labelledby={`schedule-period-${period.id}`} key={period.id}><header><period.icon size={19} aria-hidden="true" /><h3 id={`schedule-period-${period.id}`}>{period.label}</h3><span>{period.hours}</span></header><ul>{grouped[period.id].map(item => <ScheduleCard item={item} key={item.id} timeZone={timeZone} now={now} />)}</ul></section>)}</>
              : <div className="schedule-empty"><SearchX size={34} aria-hidden="true" /><h3>{query || filter !== 'all' ? 'Nenhuma estreia nesta seleção' : data?.truncated ? 'Nenhum horário listado para este dia' : 'Um dia livre para colocar os episódios em dia'}</h3><p>{query || filter !== 'all' ? 'Tente outro título, ajuste o filtro ou escolha outro dia da semana.' : data?.truncated ? 'A agenda desta semana está parcial; outros horários podem não aparecer.' : 'Não há exibições programadas para este dia no catálogo. Explore os outros dias.'}</p>{(query || filter !== 'all') && <button className="button-secondary" type="button" onClick={clearFilters}>Limpar filtros</button>}</div>}
      </section></div>
      <p className="schedule-source-note">Agenda de exibição original informada pelo AniList. Horários podem mudar. A estreia não confirma disponibilidade nas fontes, legendas ou dublagem em português.</p>
    </div>
  </main>;
}
