import { useRef, useState } from 'react';
import { mangaService } from '../services/manga';
import { mangaDetailsPath, mangaReaderPath } from '../../shared/mangaIdentity';
import { novelDetailsPath, novelReaderPath } from '../../shared/novelIdentity';
import { Bookmark, BookOpen, Check, Clock3, Heart, Star, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimeCard } from '../components/anime/AnimeCard';
import { HistoryCard } from '../components/anime/ContinueWatching';
import { libraryService, useLibrary } from '../services/library';
import { mangaLibrary, useMangaLibrary } from '../services/mangaLibrary';
import { novelLibrary, useNovelLibrary } from '../services/novelLibrary';

function ReadingCard({ title, poster, href, type, favorite, completed, onFavorite, onCompleted, onRemove, onRefreshImage }: {
  title: string; poster: string; href: string; type: string; favorite: boolean; completed: boolean;
  onFavorite: () => void; onCompleted: () => void; onRemove: () => void; onRefreshImage?: () => Promise<string>;
}) {
  const [displayPoster, setDisplayPoster] = useState(poster);
  const retried = useRef(false);
  const refreshCover = () => {
    setDisplayPoster('');
    if (!onRefreshImage || retried.current) return;
    retried.current = true;
    void onRefreshImage().then(setDisplayPoster).catch(() => undefined);
  };
  return <article className="library-reading-card"><Link to={href} className="library-reading-cover">{displayPoster ? <img src={displayPoster} alt="" loading="lazy" onError={refreshCover} /> : <BookOpen size={50} />}<span>{type}</span></Link><Link to={href}><h3>{title}</h3></Link><div className="library-card-actions"><button title={favorite ? 'Remover favorito' : 'Favoritar'} aria-label={`${favorite ? 'Remover favorito' : 'Favoritar'}: ${title}`} aria-pressed={favorite} onClick={onFavorite}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button><button title={completed ? 'Marcar em andamento' : 'Marcar concluído'} aria-label={`${completed ? 'Marcar em andamento' : 'Marcar concluído'}: ${title}`} aria-pressed={completed} onClick={onCompleted}><Check size={15} />{completed ? 'Concluído' : 'Concluir'}</button><button aria-label={`Remover da lista: ${title}`} onClick={onRemove}><Trash2 size={14} /></button></div></article>;
}

export function LibraryPage() {
  const anime = useLibrary();
  const manga = useMangaLibrary();
  const novels = useNovelLibrary();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'favorites' ? 'favorites' : params.get('tab') === 'history' ? 'history' : 'list';
  const format = params.get('format') || 'all';
  const showAnime = format === 'all' || format === 'anime';
  const showManga = format === 'all' || format === 'manga';
  const showNovels = format === 'all' || format === 'novel';
  const animeList = showAnime ? anime.list.filter(entry => tab !== 'favorites' || entry.favorite) : [];
  const mangaList = showManga ? manga.saved.filter(entry => tab !== 'favorites' || entry.favorite) : [];
  const novelList = showNovels ? novels.saved.filter(entry => tab !== 'favorites' || entry.favorite) : [];
  const total = animeList.length + mangaList.length + novelList.length;
  const historyCount = (showAnime ? anime.history.length : 0) + (showManga ? manga.history.length : 0) + (showNovels ? novels.history.length : 0);
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next); };
  const tabs = [{ key: 'list', label: 'Minha lista', icon: Bookmark }, { key: 'favorites', label: 'Favoritos', icon: Heart }, { key: 'history', label: 'Histórico', icon: Clock3 }];
  return <main id="main-content" className="page-shell content-width library-page"><div className="page-heading"><span className="eyebrow">SEU ESPAÇO</span><h1>Histórias para chamar de suas.</h1><p>Anime, mangá ou novel. Seus favoritos e o ponto em que cada história parou.</p></div><div className="library-toolbar"><div className="library-tabs" role="tablist" aria-label="Biblioteca">{tabs.map(({ key, label, icon: Icon }) => <button key={key} role="tab" id={`tab-${key}`} aria-controls="library-panel" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => update('tab', key)}><Icon size={17} />{label}</button>)}</div><label className="filter-field"><span>Formato</span><select aria-label="Formato da biblioteca" value={format} onChange={event => update('format', event.target.value)}><option value="all">Todas as histórias</option><option value="anime">Animes</option><option value="manga">Mangás</option><option value="novel">Novels</option></select></label></div>
    <div role="tabpanel" id="library-panel" aria-labelledby={`tab-${tab}`}>
      {tab === 'history' ? <>{showAnime && anime.history.length > 0 && <section className="catalog-row"><div className="section-heading"><h2>Continuar assistindo</h2></div><div className="history-grid">{anime.history.map(entry => <HistoryCard key={entry.episodeId} progress={entry} />)}</div></section>}{showManga && manga.history.length > 0 && <section className="catalog-row"><div className="section-heading"><h2>Continuar lendo mangás</h2></div><div className="reading-history-grid">{manga.history.map(entry => <Link className="reading-history-card" key={entry.manga.id} to={mangaReaderPath(entry.manga.id, entry.chapterId)}><BookOpen size={22} /><div><h3>{entry.manga.title}</h3><p>{entry.chapterTitle} · {entry.language} · página {entry.page + 1} de {entry.pageCount}</p><progress value={entry.page + 1} max={entry.pageCount} /></div></Link>)}</div></section>}{showNovels && novels.history.length > 0 && <section className="catalog-row"><div className="section-heading"><h2>Continuar lendo novels</h2></div><div className="reading-history-grid">{novels.history.map(entry => <Link className="reading-history-card" key={`${entry.novel.id}:${entry.chapterId}`} to={novelReaderPath(entry.novel.id, entry.chapterId)}><BookOpen size={22} /><div><h3>{entry.novel.title}</h3><p>{entry.chapterTitle} · {Math.round((entry.position + 1) / entry.paragraphCount * 100)}% lido</p><progress value={entry.position + 1} max={entry.paragraphCount} /></div></Link>)}</div></section>}{!historyCount && <EmptyLibrary history />}</> : total ? <div className="catalog-grid">{animeList.map(entry => <div className="library-card" key={`anime:${entry.anime.id}`}><AnimeCard anime={entry.anime} /><div className="library-card-actions"><button aria-label={`Favoritar: ${entry.anime.title}`} aria-pressed={entry.favorite} onClick={() => libraryService.toggleFavorite(entry.anime)}><Star size={14} fill={entry.favorite ? 'currentColor' : 'none'} /></button><button aria-label={`Marcar concluído: ${entry.anime.title}`} aria-pressed={!!entry.completed} onClick={() => libraryService.markCompleted(entry.anime.id)}><Check size={14} />{entry.completed ? 'Concluído' : 'Concluir'}</button></div></div>)}{mangaList.map(entry => <ReadingCard key={`manga:${entry.manga.id}`} title={entry.manga.title} poster={entry.manga.poster} href={mangaDetailsPath(entry.manga.id)} type="Mangá" favorite={entry.favorite} completed={entry.completed} onFavorite={() => mangaLibrary.toggleFavorite(entry.manga)} onCompleted={() => mangaLibrary.markCompleted(entry.manga.id)} onRemove={() => mangaLibrary.toggle(entry.manga)} onRefreshImage={async () => (await mangaService.details(entry.manga.id)).poster} />)}{novelList.map(entry => <ReadingCard key={`novel:${entry.novel.id}`} title={entry.novel.title} poster={entry.novel.poster} href={novelDetailsPath(entry.novel.id)} type="Light novel" favorite={entry.favorite} completed={entry.completed} onFavorite={() => novelLibrary.toggleFavorite(entry.novel)} onCompleted={() => novelLibrary.markCompleted(entry.novel.id)} onRemove={() => novelLibrary.toggle(entry.novel)} />)}</div> : <EmptyLibrary />}
    </div>{[anime.storageError, manga.storageError, novels.storageError].filter(Boolean).map((error, i) => <p role="alert" className="subtle-error" key={i}>{error}</p>)}<p className="library-local-note">Sua biblioteca é salva neste navegador, sem necessidade de conta.</p></main>;
}

function EmptyLibrary({ history = false }: { history?: boolean }) {
  return <div className="catalog-state"><span className="state-icon">{history ? <Clock3 size={29} /> : <Bookmark size={29} />}</span><h2>{history ? 'A primeira história é só o começo' : 'Sua lista começa com uma descoberta'}</h2><p>{history ? 'Seu progresso de reprodução e leitura aparece aqui para continuar quando quiser.' : 'Guarde animes, mangás e novels e marque seus favoritos.'}</p><div className="flex flex-wrap justify-center gap-3"><Link to="/explore" className="button-primary">Animes</Link><Link to="/manga" className="button-secondary">Mangás</Link><Link to="/novels" className="button-secondary">Novels</Link></div></div>;
}
