import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, TouchEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, RefreshCw, Settings2, X } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ContentChapter } from '../../shared/content';
import type { MangaChapter, MangaChapterPage, MangaChapterPages, MangaTitle } from '../../shared/manga';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { mangaLanguageLabel, mangaService } from '../services/manga';
import { mangaLibrary, useMangaLibrary } from '../services/mangaLibrary';
import { MangaError } from '../components/manga/MangaState';
import { ReaderImage } from '../components/manga/ReaderImage';
import { readReaderPreferences, readerPageStep, saveReaderPreferences } from '../components/manga/readerPreferences';
import type { ReaderPreferences } from '../components/manga/readerPreferences';
import { contentService, sourceMangaProgress, sourceParams, sourceQuery, sourceSuffix } from '../services/content';
import '../manga.css';

const readerChapter = (chapter: ContentChapter, pages = 0): MangaChapter => ({ id: chapter.id, mangaId: chapter.workId, title: chapter.title, chapter: chapter.number ?? null, volume: null, language: chapter.language, groups: chapter.credits, pages });
interface ReaderData extends Omit<MangaChapterPages, 'sourceUrl'> { manga?: MangaTitle; title: string; availableLanguages: string[]; sourceUrl?: string; attribution?: string }

function MangaReader({ mangaId, chapterId, sourceHints }: { mangaId: string; chapterId: string; sourceHints?: string }) {
  const navigate = useNavigate(); const [retry, setRetry] = useState(0); const [showSettings, setShowSettings] = useState(false);
  const [compactScreen, setCompactScreen] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  const [preferences, setPreferences] = useState(readReaderPreferences); const [preferenceError, setPreferenceError] = useState('');
  const effectiveMode = preferences.mode === 'double' && compactScreen ? 'single' : preferences.mode;
  const saved = sourceHints !== undefined ? sourceMangaProgress.get(mangaId, sourceQuery(new URLSearchParams(sourceHints))) : mangaLibrary.progress(mangaId);
  const savedPage = saved?.chapterId === chapterId ? saved.page : 0;
  const [page, setPage] = useState(savedPage); const [ready, setReady] = useState(false); const [loadedPages, setLoadedPages] = useState<ReadonlySet<number>>(() => new Set()); const [feedPage, setFeedPage] = useState(1);
  const [fullscreenError, setFullscreenError] = useState('');
  const readerRef = useRef<HTMLElement>(null); const pagesRef = useRef<HTMLDivElement>(null); const restoredRef = useRef(false);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const dataLoader = useCallback(async (): Promise<ReaderData> => {
    if (sourceHints !== undefined) {
      const query = sourceQuery(new URLSearchParams(sourceHints));
      const content = await contentService.pages(mangaId, chapterId, query);
      if (content.chapter.workId.replace(/^anilist:/, '') !== mangaId.replace(/^anilist:/, '')) throw new Error('Este capítulo pertence a outra obra. Abra novamente a lista de capítulos.');
      return { title: query.titles?.[0] || `AniList ${mangaId}`, availableLanguages: [content.chapter.language], chapter: readerChapter(content.chapter, content.pages.length), pages: content.pages, sourceUrl: content.sourceUrl, attribution: content.attribution || content.chapter.providerName, navigation: { previousId: content.previousChapterId, nextId: content.nextChapterId } };
    }
    const [manga, content] = await Promise.all([mangaService.details(mangaId), mangaService.pages(chapterId)]);
    if (content.chapter.mangaId !== mangaId) throw new Error('Este capítulo pertence a outra obra. Volte ao catálogo para abrir a edição correta.');
    return { manga, title: manga.title, availableLanguages: manga.availableLanguages, ...content };
  }, [mangaId, chapterId, sourceHints]);
  const request = useCatalogRequest(`reader:${mangaId}:${chapterId}:${sourceHints}:${retry}`, dataLoader);
  const data = request.data; const count = data?.pages.length ?? 0;
  const current = Math.max(0, Math.min(page, count - 1));
  const language = data?.chapter.language ?? (sourceHints !== undefined ? sourceQuery(new URLSearchParams(sourceHints)).language || 'pt-br' : 'pt-br');
  const feedLoader = useCallback(async (): Promise<MangaChapterPage> => {
    if (sourceHints === undefined) return mangaService.chapters(mangaId, language, feedPage);
    const query = sourceQuery(new URLSearchParams(sourceHints));
    const chapters = await contentService.chapters('manga', mangaId, { ...query, language });
    return { items: chapters.chapters.map(chapter => readerChapter(chapter)), language, page: 1, total: chapters.chapters.length, hasNextPage: false };
  }, [mangaId, language, feedPage, sourceHints]);
  const feed = useCatalogRequest(`reader-feed:${mangaId}:${language}:${feedPage}:${sourceHints}`, feedLoader);
  const { storageError } = useMangaLibrary();
  const nextChapter = data?.navigation?.nextId; const previousChapter = data?.navigation?.previousId;
  const setPreference = <K extends keyof ReaderPreferences>(key: K, value: ReaderPreferences[K]) => {
    const next = { ...preferences, [key]: value }; setPreferences(next);
    if (!saveReaderPreferences(next)) setPreferenceError('O navegador não permitiu salvar as preferências. Elas valem para esta sessão.');
    else setPreferenceError('');
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const change = () => setCompactScreen(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  const goPage = useCallback((next: number) => {
    const index = Math.max(0, Math.min(count - 1, next)); setPage(index);
    if (effectiveMode === 'vertical') pagesRef.current?.querySelector(`[data-page="${index}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [count, effectiveMode]);
  const step = useCallback((direction: 1 | -1) => goPage(readerPageStep(page, direction, count, effectiveMode)), [page, goPage, count, effectiveMode]);
  const detailsPath = sourceHints === undefined ? `/manga/${mangaId}` : (() => { const params = sourceParams(sourceQuery(new URLSearchParams(sourceHints))); params.set('kind', 'manga'); params.set('id', mangaId); params.set('open', '1'); return `/sources?${params}`; })();
  const openChapter = useCallback((id: string) => navigate(sourceHints === undefined ? `/manga/${mangaId}/read/${id}` : `/sources/manga/${encodeURIComponent(mangaId)}/read/${encodeURIComponent(id)}${sourceHints}`), [navigate, mangaId, sourceHints]);
  const fullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) { setFullscreenError('Tela cheia não está disponível neste navegador.'); return; }
    const operation = document.fullscreenElement ? document.exitFullscreen() : readerRef.current?.requestFullscreen();
    void operation?.catch(() => setFullscreenError('Não foi possível entrar em tela cheia. Tente pelo botão do navegador.'));
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target?.tagName)) return;
      const next = preferences.direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const previous = preferences.direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (event.key === next || event.key === 'PageDown') { event.preventDefault(); step(1); }
      else if (event.key === previous || event.key === 'PageUp') { event.preventDefault(); step(-1); }
      else if (event.key === 'Home') { event.preventDefault(); goPage(0); }
      else if (event.key === 'End') { event.preventDefault(); goPage(count - 1); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fullscreen(); }
      else if (event.key === ']' && nextChapter) { event.preventDefault(); openChapter(nextChapter); }
      else if (event.key === '[' && previousChapter) { event.preventDefault(); openChapter(previousChapter); }
      else if (event.key === 'Escape') setShowSettings(false);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [preferences.direction, count, step, goPage, fullscreen, openChapter, nextChapter, previousChapter]);
  useEffect(() => {
    if (!data || !count || !ready || !loadedPages.has(current)) return;
    if (sourceHints !== undefined) sourceMangaProgress.save(mangaId, sourceQuery(new URLSearchParams(sourceHints)), { chapterId, page: current, pageCount: count });
    else if (data.manga) mangaLibrary.saveProgress({ manga: data.manga, chapterId, chapterTitle: data.chapter.title, language: data.chapter.language, page: current, pageCount: count });
  }, [current, count, ready, data, chapterId, loadedPages, mangaId, sourceHints]);
  useEffect(() => {
    if (!data || !count || !ready || effectiveMode !== 'vertical' || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const index = Number((visible[0]?.target as HTMLElement | undefined)?.dataset.page);
      if (Number.isInteger(index) && index >= 0) setPage(index);
    }, { root: document.fullscreenElement === readerRef.current ? readerRef.current : null, rootMargin: '-15% 0px -50% 0px', threshold: 0 });
    pagesRef.current?.querySelectorAll('[data-page]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [data, count, ready, effectiveMode]);
  useEffect(() => {
    if (!data || !count) return;
    // Only two pages ahead: avoid prefetching complete chapters or retaining image blobs.
    const images = data.pages.slice(current + 1, current + 3).map((src) => { const image = new Image(); image.src = src; return image; });
    return () => { images.forEach((image) => { image.src = ''; }); };
  }, [data, count, current]);
  const imageLoaded = (index: number) => {
    setLoadedPages((previous) => previous.has(index) ? previous : new Set([...previous, index]));
    if (restoredRef.current || index !== current) return;
    restoredRef.current = true;
    if (effectiveMode === 'vertical' && current > 0) pagesRef.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: 'start' });
    setReady(true);
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (!touchRef.current || effectiveMode === 'vertical' || preferences.zoom > 1) return;
    const touch = event.changedTouches[0]; const dx = touch.clientX - touchRef.current.x; const dy = touch.clientY - touchRef.current.y; touchRef.current = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) step((preferences.direction === 'rtl' ? dx > 0 : dx < 0) ? 1 : -1);
  };
  const doubleStart = current === 0 ? 0 : current % 2 === 0 ? current - 1 : current;
  const displayed = effectiveMode === 'double' ? (current === 0 ? [0] : [doubleStart, doubleStart + 1].filter((index) => index < count)) : [current];
  const readerStyle = { '--reader-width': `${Math.min(preferences.width, document.documentElement.clientWidth)}px`, '--reader-zoom': preferences.zoom } as CSSProperties;
  return <main ref={readerRef} id="main-content" className={`manga-reader reader-theme-${preferences.theme} reader-mode-${effectiveMode} reader-fit-${preferences.fit}`} style={readerStyle}>
    <header className="reader-toolbar"><Link to={detailsPath} className="reader-back"><ArrowLeft size={18} /><span>{data?.title || 'Voltar à obra'}</span></Link><div className="reader-toolbar-actions"><span>{count ? `${current + 1} / ${count}` : 'Leitor de mangás'}</span><button aria-label="Atualizar capítulo" title="Atualizar capítulo" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={18} /></button><button aria-label="Tela cheia" title="Tela cheia (F)" onClick={fullscreen}><Maximize size={18} /></button><button aria-label="Preferências de leitura" aria-expanded={showSettings} onClick={() => setShowSettings((value) => !value)}><Settings2 size={20} /></button></div></header>
    {showSettings && <section className="reader-settings" aria-label="Preferências de leitura"><div className="reader-settings-title"><h2>Sua leitura, do seu jeito</h2><button aria-label="Fechar preferências" onClick={() => setShowSettings(false)}><X size={18} /></button></div><div className="reader-settings-grid">
      <label>Modo<select value={preferences.mode} onChange={(event) => setPreference('mode', event.target.value as ReaderPreferences['mode'])}><option value="vertical">Vertical contínuo</option><option value="single">Paginado · página única</option><option value="double">Paginado · página dupla</option></select></label>
      <label>Tema<select value={preferences.theme} onChange={(event) => setPreference('theme', event.target.value as ReaderPreferences['theme'])}><option value="dark">Escuro</option><option value="light">Claro</option><option value="sepia">Sépia</option></select></label>
      <label>Ajuste<select value={preferences.fit} onChange={(event) => setPreference('fit', event.target.value as ReaderPreferences['fit'])}><option value="width">À largura</option><option value="height">À altura</option><option value="original">Tamanho original</option></select></label>
      <label>Sentido<select value={preferences.direction} onChange={(event) => setPreference('direction', event.target.value as ReaderPreferences['direction'])}><option value="rtl">Direita para esquerda</option><option value="ltr">Esquerda para direita</option></select></label>
      <label>Largura · {preferences.width}px<input type="range" min="400" max="1600" step="50" value={preferences.width} onChange={(event) => setPreference('width', Number(event.target.value))} /></label>
      <label>Zoom · {Math.round(preferences.zoom * 100)}%<input type="range" min="0.5" max="2.5" step="0.1" value={preferences.zoom} onChange={(event) => setPreference('zoom', Number(event.target.value))} /></label>
    </div><p>← → / Page Up / Page Down: páginas · Home / End: início e fim · F: tela cheia · [ / ]: capítulos. Em telas pequenas, a página dupla se adapta para página única.</p></section>}
    {(storageError || preferenceError || fullscreenError) && <p className="reader-notice" role="status">{storageError || preferenceError || fullscreenError}</p>}
    {request.loading ? <div className="reader-loading" aria-busy="true"><div className="skeleton" /><p>Preparando seu capítulo…</p></div> : request.error ? <MangaError message={request.error} retry={() => setRetry((value) => value + 1)} /> : data && !count ? <div className="catalog-state"><h1>{data.chapter.externalUrl ? 'Leia esta edição na fonte oficial' : 'Este capítulo ainda não tem páginas disponíveis'}</h1><p>{data.chapter.externalUrl ? 'Esta edição é distribuída pelo site indicado no MangaDex.' : 'Tente atualizar ou escolha outra edição na lista de capítulos.'}</p>{data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="button-primary">Abrir fonte ↗</a>}<Link to={detailsPath} className="button-secondary">Escolher outra edição</Link></div> : data && <>
      <div className="reader-chapter-heading"><span className="eyebrow">{mangaLanguageLabel(data.chapter.language)}</span><h1>{data.chapter.title}</h1><p>{data.chapter.groups.join(' · ') || 'Grupo não informado'}</p></div>
      <div className="reader-stage" onTouchStart={(event) => { if (event.touches.length === 1) touchRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; else touchRef.current = null; }} onTouchEnd={onTouchEnd}>
        <div ref={pagesRef} className={`reader-pages ${preferences.direction === 'rtl' ? 'reader-rtl' : ''}`}>
          {effectiveMode === 'vertical' ? data.pages.map((src, index) => <ReaderImage key={`${src}:${retry}`} src={src} number={index + 1} eager={index < 2 || Math.abs(index - current) <= 1} onLoaded={() => imageLoaded(index)} />) : displayed.map((index) => <ReaderImage key={`${data.pages[index]}:${retry}`} src={data.pages[index]} number={index + 1} eager onLoaded={() => imageLoaded(index)} />)}
        </div>
      </div>
      <nav className="reader-page-navigation" aria-label="Navegação de páginas"><button className="button-secondary" disabled={current <= 0} onClick={() => step(-1)}><ChevronLeft size={18} />Página anterior</button><label>Página<select value={current} onChange={(event) => goPage(Number(event.target.value))}>{data.pages.map((_, index) => <option key={index} value={index}>{index + 1} de {count}</option>)}</select></label><button className="button-primary" disabled={current >= count - 1} onClick={() => step(1)}>Próxima página<ChevronRight size={18} /></button></nav>
      <nav className="reader-chapter-navigation" aria-label="Navegação de capítulos"><button className="button-secondary" disabled={!previousChapter} onClick={() => previousChapter && openChapter(previousChapter)}>← Capítulo anterior</button><Link className="button-secondary" to={detailsPath}>Todas as edições</Link><button className="button-primary" disabled={!nextChapter} onClick={() => nextChapter && openChapter(nextChapter)}>Próximo capítulo →</button></nav>
      {!data.navigation && <p className="reader-notice">A navegação entre capítulos não pôde ser carregada. Escolha uma edição na lista abaixo.</p>}
      <section className="reader-editions"><div><h2>Outras edições</h2><label>Idioma<select value={language} onChange={(event) => {
        if (sourceHints === undefined) navigate(`/manga/${mangaId}?language=${encodeURIComponent(event.target.value)}`);
        else { const params = new URLSearchParams(detailsPath.split('?')[1]); params.set('language', event.target.value); navigate(`/sources?${params}`); }
      }}>{[...new Set(['pt-br', language, ...data.availableLanguages])].map((lang) => <option key={lang} value={lang}>{mangaLanguageLabel(lang)}</option>)}</select></label></div>{feed.error ? <p role="status">{feed.error} <Link to={detailsPath}>Abrir lista de capítulos</Link></p> : <><label>Capítulos<select value={feed.data?.items.some((chapter) => chapter.id === chapterId) ? chapterId : ''} onChange={(event) => event.target.value && openChapter(event.target.value)}><option value="" disabled>{feed.loading ? 'Carregando capítulos…' : 'Escolha uma edição'}</option>{feed.data?.items.filter((chapter) => !chapter.externalUrl).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.chapter ? `${chapter.chapter} · ` : ''}{chapter.title} · {chapter.groups.join(', ') || 'Sem grupo'}</option>)}</select></label><div className="manga-pagination"><button className="button-secondary" disabled={feedPage <= 1} onClick={() => setFeedPage((value) => value - 1)}>Anterior</button><span>Lista {feedPage}</span><button className="button-secondary" disabled={!feed.data?.hasNextPage} onClick={() => setFeedPage((value) => value + 1)}>Próxima</button></div></>}
      <p className="manga-credit">{sourceHints === undefined ? <>Capítulo fornecido pelo <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">MangaDex ↗</a>.</> : <>Fonte: {data.attribution}. {data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir origem ↗</a>}</>} Seu progresso fica salvo neste dispositivo quando o armazenamento está disponível.</p></section>
    </>}
  </main>;
}
export function MangaReaderPage() { const { mangaId = '', chapterId = '' } = useParams(); return <MangaReader key={`${mangaId}:${chapterId}`} mangaId={mangaId} chapterId={chapterId} />; }

export function SourceMangaReaderPage() {
  const { mangaId = '', chapterId = '' } = useParams();
  const [params] = useSearchParams();
  const hints = sourceSuffix(sourceQuery(params));
  return <MangaReader key={`${mangaId}:${chapterId}:${hints}`} mangaId={mangaId} chapterId={chapterId} sourceHints={hints} />;
}
