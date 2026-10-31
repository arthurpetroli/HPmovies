import { useCallback, useState } from 'react';
import { BookOpen, Bookmark, Heart, ArrowLeft } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { mangaLanguageLabel, mangaService, mangaStatusLabel } from '../services/manga';
import { mangaLibrary, useMangaLibrary } from '../services/mangaLibrary';
import { MangaError, MangaLoading } from '../components/manga/MangaState';
import { MangaDownloadButton } from '../components/manga/MangaDownloadButton';
import { MangaSourceLink } from '../components/manga/MangaSourceLink';
import { MangaArchivePanel } from '../components/manga/MangaArchivePanel';
import { mangaChapterSource, mangaProviderForId, mangaProviderLabel, mangaReaderPath } from '../../shared/mangaIdentity';
import '../manga.css';

function MangaDetails({ id }: { id: string }) {
  const [query, setQuery] = useSearchParams();
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
  const provider = mangaProviderForId(id); const providerLabel = mangaProviderLabel(provider);
  const firstChapter = feed.data?.items.find(chapter => !chapter.externalUrl && (chapter.pages > 0 || provider === 'mangalivre'));
  const languages = [...new Set(['pt-br', 'pt', language, ...(manga?.availableLanguages ?? [])])];
  return <main id="main-content" className="manga-page content-width page-shell">
    <Link className="manga-back" to={`/manga?provider=${provider}`}><ArrowLeft size={16} />Explorar mangás</Link>
    {detail.loading ? <MangaLoading /> : detail.error ? <MangaError message={detail.error} retry={() => setRetry((value) => value + 1)} /> : manga && <>
      <section className="manga-detail-hero"><div className="manga-detail-poster">{manga.poster ? <img src={manga.poster} alt={`Capa de ${manga.title}`} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <BookOpen size={56} />}</div><div className="manga-detail-copy"><span className="eyebrow">MANGÁ · {mangaStatusLabel(manga.status).toUpperCase()}</span><h1>{manga.title}</h1><div className="manga-meta"><span>{manga.year}</span>{manga.authors.map((author) => <span key={author}>{author}</span>)}<span>{provider === 'mangalivre' ? 'Classificação não informada pela fonte' : manga.contentRating === 'safe' ? 'Conteúdo: seguro no MangaDex' : 'Conteúdo: sugestivo no MangaDex'}</span></div><div className="manga-detail-tags">{manga.tags.slice(0, 9).map((tag) => <Link to={`/manga?${new URLSearchParams({ tag: tag.id, provider })}`} key={tag.id}>{tag.name}</Link>)}</div><p className="manga-synopsis">{manga.description || 'Esta obra ainda não possui uma sinopse disponível.'}</p><div className="manga-detail-actions">
        {progress ? <Link className="button-primary" to={mangaReaderPath(id, progress.chapterId)}><BookOpen size={18} />Retomar · página {progress.page + 1}</Link> : firstChapter ? <Link className="button-primary" to={mangaReaderPath(id, firstChapter.id)}><BookOpen size={18} />Começar a ler</Link> : null}
        <button className={entry ? 'button-primary' : 'button-secondary'} onClick={() => mangaLibrary.toggle(manga)} aria-pressed={!!entry}><Bookmark size={17} fill={entry ? 'currentColor' : 'none'} />{entry ? 'Na minha lista' : 'Minha lista'}</button><button className={`button-secondary ${entry?.favorite ? 'manga-is-favorite' : ''}`} onClick={() => mangaLibrary.toggleFavorite(manga)} aria-pressed={!!entry?.favorite}><Heart size={17} fill={entry?.favorite ? 'currentColor' : 'none'} />Favoritar</button><MangaSourceLink href={manga.sourceUrl} label={`Ver obra no ${providerLabel}`} />
      </div>{storageError && <p className="manga-notice" role="status">{storageError}</p>}</div></section>
      <section className="manga-chapters"><div className="section-heading"><div><span className="eyebrow">SUA PRÓXIMA LEITURA</span><h2>Capítulos e edições</h2><p>Leia aqui, abra no provedor ou baixe um capítulo para ler offline.</p></div><label className="manga-language">Idioma<select value={language} onChange={(event) => { setLanguage(event.target.value); setPage(1); const next = new URLSearchParams(query); next.set('language', event.target.value); setQuery(next, { replace: true }); }}>{languages.map((lang) => <option key={lang} value={lang}>{mangaLanguageLabel(lang)}{lang === 'pt-br' ? ' · preferencial' : ''}</option>)}</select></label></div>
        <p className="manga-download-help">CBZ reúne as imagens de um capítulo em um arquivo para leitores de quadrinhos. O download mantém o idioma e o grupo escolhidos. Edições externas abrem no provedor.</p>
        {!manga.availableLanguages.includes('pt-br') && <p className="manga-notice">O catálogo não informa uma tradução PT-BR disponível para esta obra. Você pode selecionar outro idioma acima.</p>}
        {feed.loading ? <p className="manga-feed-loading" aria-busy="true">Buscando capítulos em {mangaLanguageLabel(language)}…</p> : feed.error ? <MangaError message={feed.error} retry={() => setFeedRetry((value) => value + 1)} /> : feed.data?.items.length ? <><p className="manga-chapter-count">{feed.data.total} edições · {mangaLanguageLabel(language)}</p><div className="manga-chapter-list">{feed.data.items.map((chapter) => {
          const destination = chapter.externalUrl || mangaReaderPath(id, chapter.id);
          const body = <><span className="manga-chapter-number">{chapter.chapter || 'EXTRA'}</span><div><strong>{chapter.title}</strong><span>{chapter.volume ? `Vol. ${chapter.volume} · ` : ''}{mangaLanguageLabel(chapter.language)} · {chapter.groups.join(', ') || 'Grupo não informado'}</span></div><span className="manga-chapter-pages">{chapter.externalUrl ? 'Leitura externa ↗' : chapter.pages ? `${chapter.pages} páginas` : 'Abrir capítulo'}</span></>;
          return <div key={chapter.id} className="manga-chapter-row">
            {chapter.externalUrl ? <a className="manga-chapter-item" href={destination} target="_blank" rel="noopener noreferrer">{body}</a> : <Link className={`manga-chapter-item ${progress?.chapterId === chapter.id ? 'manga-chapter-current' : ''}`} to={destination}>{body}</Link>}
            <div className="manga-chapter-actions">
              <MangaSourceLink href={chapter.externalUrl || mangaChapterSource(chapter.id)} label={chapter.externalUrl ? 'Abrir no provedor' : `Abrir no ${providerLabel}`} ariaLabel={`Abrir ${chapter.title} ${chapter.externalUrl ? 'no provedor' : `no ${providerLabel}`}`} />
              {!chapter.externalUrl && (chapter.pages > 0 || provider === 'mangalivre') && <MangaDownloadButton label={`Baixar ${chapter.title} em CBZ`} load={async () => {
                const content = await mangaService.pages(chapter.id);
                if (content.chapter.mangaId !== id || content.chapter.id !== chapter.id || content.chapter.language !== chapter.language || content.chapter.externalUrl) throw new Error('A edição retornada não corresponde ao capítulo escolhido. Atualize a lista e tente novamente.');
                return { title: manga.title, chapterTitle: chapter.title, language: content.chapter.language, pages: content.pages, sourceUrl: content.sourceUrl, credits: content.chapter.groups };
              }} />}
            </div>
          </div>;
        })}</div><nav className="manga-pagination" aria-label="Paginação de capítulos"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page}</span><button className="button-secondary" disabled={!feed.data.hasNextPage} onClick={() => setPage((value) => value + 1)}>Próxima</button></nav></> : <div className="catalog-state"><BookOpen size={32} /><h3>Nenhum capítulo em {mangaLanguageLabel(language)}</h3><p>Experimente outro idioma. O catálogo da obra continua disponível.</p></div>}
      </section>
      <MangaArchivePanel mangaId={id} language={language} />
    </>}
  </main>;
}
export function MangaDetailsPage() { const { mangaId = '' } = useParams(); return <MangaDetails key={mangaId} id={mangaId} />; }
