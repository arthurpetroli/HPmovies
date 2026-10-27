import { genreLabel } from './genreLabels';

export function GenreChips({ selected, onSelect, list }: { selected: string | null; onSelect: (genre: string | null) => void; list: string[] }) {
  return <div className="genre-chips scrollbar-hide"><button className={`genre-chip ${selected == null ? 'active' : ''}`} onClick={() => onSelect(null)} aria-pressed={selected == null}>Todos</button>{list.map((genre) => <button key={genre} className={`genre-chip ${selected === genre ? 'active' : ''}`} onClick={() => onSelect(genre)} aria-pressed={selected === genre}>{genreLabel(genre)}</button>)}</div>;
}
