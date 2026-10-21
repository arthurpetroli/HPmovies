import { useCallback, useState } from 'react';
import { BookOpen, Bookmark, Heart, ArrowLeft, ExternalLink } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { mangaLanguageLabel, mangaService, mangaStatusLabel } from '../services/manga';
import { mangaLibrary, useMangaLibrary } from '../services/mangaLibrary';
import { MangaError, MangaLoading } from '../components/manga/MangaState';
import '../manga.css';

function MangaDetails({ id }: { id: string }) {
  const [query] = useSearchParams();
  const requestedLanguage = query.get('language') || 'pt-br';
  const initialLanguage = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(requestedLanguage) ? requestedLanguage : 'pt-br';
  const [retry, setRetry] = useState(0); const [feedRetry, setFeedRetry] = useState(0); const [language, setLanguage] = useState(initialLanguage); const [page, setPage] = useState(1);
  const detailLoader = useCallback(() => mangaService.details(id), [id]);
  const chapterLoader = useCallback(() => mangaService.chapters(id, language, page), [id, language, page]);
  const detail = useCatalogRequest(`manga:${id}:${retry}`, detailLoader);
  const feed = useCatalogRequest(`manga-chapters:${id}:${language}:${page}:${feedRetry}`, chapterLoader);
  const { saved, history, storageError } = useMangaLibrary();
  const entry = saved.find((entry) => entry.manga.id === id); const progress = history.find((entry) => entry.manga.id === id);
  const manga = detail.data;
  const languages = [...new Set(['pt-br', language, ...(manga?.availableLanguages ?? [])])];
  return <main id="main-content" className="manga-page content-width page-shell">
    <Link className="manga-back" to="/manga"><ArrowLeft size={16} />Explorar mangás</Link>
    {detail.loading ? <MangaLoading /> : detail.error ? <MangaError message={detail.error} retry={() => setRetry((value) => value + 1)} /> : manga && <>
      <section className="manga-detail-hero"><div className="manga-detail-poster">{manga.poster ? <img src={manga.poster} alt={`Capa de ${manga.title}`} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <BookOpen size={56} />}</div><div className="manga-detail-copy"><span className="eyebrow">MANGÁ · {mangaStatusLabel(manga.status).toUpperCase()}</span><h1>{manga.title}</h1><div className="manga-meta"><span>{manga.year}</span>{manga.authors.map((author) => <span key={author}>{author}</span>)}<span>{manga.contentRating === 'safe' ? 'Conteúdo: seguro no MangaDex' : 'Conteúdo: sugestivo no MangaDex'}</span></div><div className="manga-detail-tags">{manga.tags.slice(0, 9).map((tag) => <Link to={`/manga?tag=${tag.id}`} key={tag.id}>{tag.name}</Link>)}</div><p className="manga-synopsis">{manga.description || 'Esta obra ainda não possui uma sinopse disponível.'}</p><div className="manga-detail-actions">
        {progress ? <Link className="button-primary" to={`/manga/${id}/read/${progress.chapterId}`}><BookOpen size={18} />Retomar · página {progress.page + 1}</Link> : feed.data?.items.find((chapter) => chapter.pages > 0 && !chapter.externalUrl) ? <Link className="button-primary" to={`/manga/${id}/read/${feed.data.items.find((chapter) => chapter.pages > 0 && !chapter.externalUrl)!.id}`}><BookOpen size={18} />Começar a ler</Link> : null}
        <button className={entry ? 'button-primary' : 'button-secondary'} onClick={() => mangaLibrary.toggle(manga)} aria-pressed={!!entry}><Bookmark size={17} fill={entry ? 'currentColor' : 'none'} />{entry ? 'Na minha lista' : 'Minha lista'}</button><button className={`button-secondary ${entry?.favorite ? 'manga-is-favorite' : ''}`} onClick={() => mangaLibrary.toggleFavorite(manga)} aria-pressed={!!entry?.favorite}><Heart size={17} fill={entry?.favorite ? 'currentColor' : 'none'} />Favoritar</button><a className="manga-source" href={manga.sourceUrl} target="_blank" rel="noopener noreferrer">MangaDex <ExternalLink size={14} /></a>
      </div>{storageError && <p className="manga-notice" role="status">{storageError}</p>}</div></section>
      <section className="manga-chapters"><div className="section-heading"><div><span className="eyebrow">SUA PRÓXIMA LEITURA</span><h2>Capítulos e edições</h2><p>Escolha o idioma e o grupo de tradução de cada capítulo.</p></div><label className="manga-language">Idioma<select value={language} onChange={(event) => { setLanguage(event.target.value); setPage(1); }}>{languages.map((lang) => <option key={lang} value={lang}>{mangaLanguageLabel(lang)}{lang === 'pt-br' ? ' · preferencial' : ''}</option>)}</select></label></div>
        {!manga.availableLanguages.includes('pt-br') && <p className="manga-notice">O catálogo não informa uma tradução PT-BR disponível para esta obra. Você pode selecionar outro idioma acima.</p>}
        {feed.loading ? <p className="manga-feed-loading" aria-busy="true">Buscando capítulos em {mangaLanguageLabel(language)}…</p> : feed.error ? <MangaError message={feed.error} retry={() => setFeedRetry((value) => value + 1)} /> : feed.data?.items.length ? <><p className="manga-chapter-count">{feed.data.total} edições · {mangaLanguageLabel(language)}</p><div className="manga-chapter-list">{feed.data.items.map((chapter) => {
          const destination = chapter.externalUrl || `/manga/${id}/read/${chapter.id}`;
          const body = <><span className="manga-chapter-number">{chapter.chapter || 'EXTRA'}</span><div><strong>{chapter.title}</strong><span>{chapter.volume ? `Vol. ${chapter.volume} · ` : ''}{mangaLanguageLabel(chapter.language)} · {chapter.groups.join(', ') || 'Grupo não informado'}</span></div><span className="manga-chapter-pages">{chapter.externalUrl ? 'Site oficial ↗' : `${chapter.pages} páginas`}</span></>;
          return chapter.externalUrl ? <a key={chapter.id} className="manga-chapter-item" href={destination} target="_blank" rel="noopener noreferrer">{body}</a> : <Link key={chapter.id} className={`manga-chapter-item ${progress?.chapterId === chapter.id ? 'manga-chapter-current' : ''}`} to={destination}>{body}</Link>;
        })}</div><nav className="manga-pagination" aria-label="Paginação de capítulos"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page}</span><button className="button-secondary" disabled={!feed.data.hasNextPage} onClick={() => setPage((value) => value + 1)}>Próxima</button></nav></> : <div className="catalog-state"><BookOpen size={32} /><h3>Nenhum capítulo em {mangaLanguageLabel(language)}</h3><p>Experimente outro idioma. O catálogo da obra continua disponível.</p></div>}
      </section>
    </>}
  </main>;
}
export function MangaDetailsPage() { const { mangaId = '' } = useParams(); return <MangaDetails key={mangaId} id={mangaId} />; }
