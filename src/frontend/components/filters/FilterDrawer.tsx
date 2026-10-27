import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { CatalogQuery } from '../../../shared/providers';
import { genreLabel } from './genreLabels';

const formatOptions = [{ value: 'TV', label: 'Série' }, { value: 'MOVIE', label: 'Filme' }, { value: 'OVA', label: 'OVA' }, { value: 'ONA', label: 'ONA' }, { value: 'SPECIAL', label: 'Especial' }, { value: 'TV_SHORT', label: 'Série curta' }, { value: 'MUSIC', label: 'Música' }];
const sortOptions = [{ value: 'popular', label: 'Mais populares' }, { value: 'trending', label: 'Em alta' }, { value: 'score', label: 'Melhor avaliados' }, { value: 'newest', label: 'Mais recentes' }];
const statusOptions = [{ value: 'RELEASING', label: 'Em exibição' }, { value: 'FINISHED', label: 'Concluídos' }, { value: 'NOT_YET_RELEASED', label: 'Em breve' }];
const years = Array.from({ length: new Date().getFullYear() - 1939 }, (_, index) => new Date().getFullYear() - index);

export function FilterFields({ values, onChange, genresAll }: { values: CatalogQuery; onChange: (key: keyof CatalogQuery, value: string) => void; genresAll: string[] }) {
  return <>
    <label className="filter-field"><span>Gênero</span><select aria-label="Gênero" value={values.genre || ''} onChange={(event) => onChange('genre', event.target.value)}><option value="">Todos os gêneros</option>{genresAll.map((genre) => <option key={genre} value={genre}>{genreLabel(genre)}</option>)}</select></label>
    <label className="filter-field"><span>Ano</span><select aria-label="Ano" value={values.year || ''} onChange={(event) => onChange('year', event.target.value)}><option value="">Todos os anos</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
    <label className="filter-field"><span>Temporada</span><select aria-label="Temporada" value={values.season || ''} onChange={event => onChange('season', event.target.value)}><option value="">Todas as temporadas</option><option value="WINTER">Inverno · jan–mar</option><option value="SPRING">Primavera · abr–jun</option><option value="SUMMER">Verão · jul–set</option><option value="FALL">Outono · out–dez</option></select></label>
    <label className="filter-field"><span>Formato</span><select aria-label="Formato" value={values.format || ''} onChange={(event) => onChange('format', event.target.value)}><option value="">Todos os formatos</option>{formatOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label className="filter-field"><span>Status</span><select aria-label="Status" value={values.status || ''} onChange={(event) => onChange('status', event.target.value)}><option value="">Todos os status</option>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label className="filter-field"><span>Ordenar por</span><select aria-label="Ordenar por" value={values.sort || 'popular'} onChange={(event) => onChange('sort', event.target.value)}>{sortOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
  </>;
}

interface FilterDrawerProps { open: boolean; onClose: () => void; values: CatalogQuery; onApply: (values: CatalogQuery) => void; genresAll: string[] }
function FilterDraft({ onClose, values, onApply, genresAll }: Omit<FilterDrawerProps, 'open'>) {
  const [local, setLocal] = useState(values);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') ref.current?.querySelector<HTMLButtonElement>('[data-drawer-close]')?.click();
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button, select');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus(); document.removeEventListener('keydown', onKey); };
  }, []);
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={ref} className="filter-drawer" role="dialog" aria-modal="true" aria-labelledby="filter-drawer-title"><div className="drawer-heading"><h2 id="filter-drawer-title"><SlidersHorizontal size={20} />Refine sua descoberta</h2><button className="icon-button" data-drawer-close aria-label="Fechar filtros" onClick={onClose}><X size={20} /></button></div><div className="drawer-fields"><FilterFields values={local} genresAll={genresAll} onChange={(key, value) => setLocal((current) => ({ ...current, [key]: key === 'year' ? (value ? Number(value) : undefined) : value || undefined }))} /></div><div className="drawer-actions"><button className="button-secondary" onClick={() => setLocal({ search: values.search, sort: 'popular' })}>Limpar filtros</button><button className="button-primary" onClick={() => { onApply(local); onClose(); }}>Mostrar animes</button></div></section></div>;
}
export function FilterDrawer({ open, ...props }: FilterDrawerProps) {
  return open ? <FilterDraft {...props} /> : null;
}
