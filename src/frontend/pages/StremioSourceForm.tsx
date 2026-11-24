import { useState } from 'react';
import { ArrowLeft, Film, Play } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CinemaType } from '../../shared/cinema';

const fieldClass = 'field-control min-w-0';

export function StremioSourceForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [type, setType] = useState<CinemaType>(params.get('type') === 'movie' ? 'movie' : 'series');
  const [imdb, setImdb] = useState(params.get('imdb') || '');
  const [title, setTitle] = useState(params.get('title') || '');
  const [season, setSeason] = useState(params.get('season') || '1');
  const [episode, setEpisode] = useState(params.get('episode') || '1');
  return <main id="main-content" className="page-shell content-width">
    <div className="page-heading"><h1>Abra pelas fontes Stremio.</h1><p>Use o ID IMDb de um filme, série ou anime. Para séries, informe a temporada e o episódio dessa edição.</p></div>
    <nav aria-label="Consulta de fontes" className="mb-6 flex flex-wrap gap-3"><Link className="button-secondary" to="/sources"><ArrowLeft size={16} aria-hidden="true" />Fontes AniList</Link><Link className="button-secondary" to="/cinema"><Film size={16} aria-hidden="true" />Filmes e séries</Link></nav>
    <form className="max-w-3xl surface-card p-5 sm:p-7" onSubmit={event => {
      event.preventDefault();
      const id = imdb.trim();
      if (!/^tt\d{5,12}$/.test(id)) return;
      const playbackId = type === 'movie' ? `stremio:all:movie:${id}` : `stremio:all:${id}:${Number(season)}:${Number(episode)}`;
      const query = new URLSearchParams({ origin: 'stremio' });
      if (title.trim()) query.set('title', title.trim());
      navigate(`/watch/${encodeURIComponent(playbackId)}?${query}`, { state: { fromSources: true } });
    }}>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-slate-300">Tipo de vídeo<select className={fieldClass} value={type} onChange={event => setType(event.target.value as CinemaType)}><option value="series">Série ou anime</option><option value="movie">Filme</option></select></label>
        <label className="grid gap-2 text-sm text-slate-300">ID no IMDb<input className={fieldClass} required pattern="tt[0-9]{5,12}" maxLength={14} placeholder="tt0903747" autoCapitalize="off" spellCheck={false} value={imdb} onChange={event => setImdb(event.target.value)} /></label>
        <label className="grid gap-2 text-sm text-slate-300 sm:col-span-2">Título (opcional)<input className={fieldClass} maxLength={200} placeholder="Nome para identificar no player" value={title} onChange={event => setTitle(event.target.value)} /></label>
        {type === 'series' && <><label className="grid gap-2 text-sm text-slate-300">Temporada<input className={fieldClass} type="number" required min={0} max={1000} step={1} value={season} onChange={event => setSeason(event.target.value)} /></label><label className="grid gap-2 text-sm text-slate-300">Episódio<input className={fieldClass} type="number" required min={1} max={100000} step={1} value={episode} onChange={event => setEpisode(event.target.value)} /></label></>}
      </div>
      <p className="my-5 text-sm leading-relaxed text-slate-400">O ID começa com “tt” no endereço da obra em imdb.com. As fontes conectadas serão consultadas ao abrir o player; idiomas e disponibilidade variam por vídeo.</p>
      <button className="button-primary min-h-11" type="submit"><Play size={17} aria-hidden="true" />Consultar e abrir player</button>
    </form>
    <p className="mt-5 max-w-3xl text-sm leading-relaxed text-slate-400">O número AniList identifica outra edição do catálogo. Escolha o IMDb e a numeração de temporada correspondentes ao vídeo desejado.</p>
    <Link className="button-secondary mt-6" to="/providers">Ver conexão das fontes</Link>
  </main>;
}
