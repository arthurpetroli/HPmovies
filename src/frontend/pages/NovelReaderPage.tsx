import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, List, Settings2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { NovelChapter, NovelReadingResult, NovelTitle } from '../../shared/novel';
import { CatalogError } from '../components/ui/CatalogState';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { novelService } from '../services/novels';
import { novelLibrary, useNovelLibrary } from '../services/novelLibrary';
import './novel.css';

type ReadableContent = NovelReadingResult & { novel: NovelTitle; chapter: NovelChapter };

export function NovelReaderPage() {
  const { novelId = '', chapterId = '' } = useParams();
  const [retry, setRetry] = useState(0);
  const load = useCallback(() => novelService.content(novelId, chapterId), [novelId, chapterId]);
  const { data, loading, error } = useCatalogRequest(`novel-read:${novelId}:${chapterId}:${retry}`, load);
  if (loading) return <main id="main-content" className="page-shell content-width" aria-busy="true"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-description" /><div className="skeleton skeleton-description" /></main>;
  if (error) return <main id="main-content" className="page-shell content-width"><Link className="back-link" to={`/novel/${novelId}`}><ArrowLeft size={16} />Voltar aos detalhes</Link><CatalogError message={error} onRetry={() => setRetry((value) => value + 1)} /></main>;
  if (!data?.available || !data.novel || !data.chapter || !data.paragraphs.length) return <main id="main-content" className="page-shell content-width"><div className="catalog-state"><BookOpen size={35} /><h1>Este texto ainda não está disponível</h1><p>{data?.message || 'Nenhuma fonte de texto autorizada está configurada para este capítulo.'}</p><Link className="button-primary" to="/novel/demo/read/1">Conhecer o leitor com texto original<ArrowRight size={16} /></Link><Link className="text-link" to={`/novel/${novelId}`}>Voltar aos detalhes</Link></div></main>;
  return <ReadingSession key={`${novelId}:${chapterId}`} content={data as ReadableContent} />;
}

function ReadingSession({ content }: { content: ReadableContent }) {
  const { novel, chapter, paragraphs } = content;
  const navigate = useNavigate();
  const articleRef = useRef<HTMLElement>(null);
  const [initialPosition] = useState(() => Math.min(novelLibrary.progress(novel.id, chapter.id)?.position ?? 0, paragraphs.length - 1));
  const positionRef = useRef(initialPosition);
  const [position, setPosition] = useState(initialPosition);
  const [settings, setSettings] = useState(false);
  const { preferences, storageError } = useNovelLibrary();
  const save = useCallback((value: number) => {
    novelLibrary.saveProgress({ novel, chapterId: chapter.id, chapterTitle: chapter.title, position: value, paragraphCount: paragraphs.length });
  }, [novel, chapter.id, chapter.title, paragraphs.length]);
  const updatePosition = useCallback((value: number) => {
    if (value === positionRef.current) return;
    positionRef.current = value;
    setPosition(value);
    save(value);
  }, [save]);
  const jump = (value: number) => {
    const target = articleRef.current?.querySelector<HTMLElement>(`[data-paragraph="${value}"]`);
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    updatePosition(value);
  };

  useLayoutEffect(() => {
    if (initialPosition > 0) articleRef.current?.querySelector(`[data-paragraph="${initialPosition}"]`)?.scrollIntoView({ block: 'start' });
  }, [initialPosition]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const article = articleRef.current;
      if (!article) return;
      const elements = Array.from(article.querySelectorAll<HTMLElement>('[data-paragraph]'));
      const readingLine = Math.min(210, window.innerHeight * 0.3);
      let current = 0;
      for (let index = 0; index < elements.length; index += 1) {
        if (elements[index].getBoundingClientRect().top <= readingLine) current = index;
      }
      if (article.getBoundingClientRect().bottom <= window.innerHeight - 40) current = paragraphs.length - 1;
      updatePosition(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const flush = () => save(positionRef.current);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    save(positionRef.current);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
      flush();
    };
  }, [save, updatePosition, paragraphs.length]);

  const chapterPath = (id: string) => `/novel/${novel.id}/read/${encodeURIComponent(id)}`;
  const percent = paragraphs.length === 1 ? 100 : Math.round(position / (paragraphs.length - 1) * 100);
  return <main id="main-content" className={`novel-reader novel-theme-${preferences.theme}`} lang={chapter.language} onKeyDown={(event) => {
    if ((event.target as HTMLElement).closest('button,input,select,textarea,a') || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowRight' && content.nextChapterId) { event.preventDefault(); navigate(chapterPath(content.nextChapterId)); }
    if (event.key === 'ArrowLeft' && content.previousChapterId) { event.preventDefault(); navigate(chapterPath(content.previousChapterId)); }
  }}>
    <div className="novel-reader-toolbar"><Link className="novel-reader-back" to={`/novel/${novel.id}`}><ArrowLeft size={17} /><span>Capítulos</span></Link><div className="novel-reader-context"><strong>{novel.title}</strong><span>{chapter.title}</span></div><button className="novel-reader-button" aria-label="Ajustar leitura" aria-expanded={settings} aria-controls="novel-reading-settings" onClick={() => setSettings((value) => !value)}><Settings2 size={19} /><span>Ajustes</span></button></div>
    {settings && <section id="novel-reading-settings" className="novel-reading-settings" aria-label="Preferências de leitura"><label>Tamanho da fonte <output>{preferences.fontSize}px</output><input type="range" min={16} max={30} step={1} value={preferences.fontSize} onChange={(event) => novelLibrary.setPreferences({ fontSize: Number(event.target.value) })} /></label><label>Espaçamento <output>{preferences.lineHeight.toFixed(1)}</output><input type="range" min={1.4} max={2.4} step={0.1} value={preferences.lineHeight} onChange={(event) => novelLibrary.setPreferences({ lineHeight: Number(event.target.value) })} /></label><label>Fonte<select value={preferences.font} onChange={(event) => novelLibrary.setPreferences({ font: event.target.value === 'sans' ? 'sans' : 'serif' })}><option value="serif">Serifada</option><option value="sans">Sem serifa</option></select></label><label>Tema<select value={preferences.theme} onChange={(event) => novelLibrary.setPreferences({ theme: event.target.value as 'dark' | 'light' | 'sepia' })}><option value="dark">Escuro</option><option value="light">Claro</option><option value="sepia">Sépia</option></select></label></section>}
    <div className="novel-reader-progress"><label htmlFor="novel-position">Progresso neste capítulo <strong>{percent}%</strong></label><input id="novel-position" aria-label="Posição no capítulo" type="range" min={0} max={paragraphs.length - 1} step={1} value={position} onChange={(event) => jump(Number(event.target.value))} /><span>Seu progresso e os ajustes são salvos neste navegador.</span></div>
    {storageError && <p className="novel-reader-storage" role="status">{storageError}</p>}
    <div className="novel-reading-body">
      {content.isDemo && <aside className="novel-original-note"><BookOpen size={17} /><p>Texto original de demonstração do HPmovies, em português. Este conteúdo permite experimentar o leitor e a retomada de leitura.</p></aside>}
      <header className="novel-reading-heading"><span>CAPÍTULO {chapter.number}</span><h1>{chapter.title}</h1><p>{novel.title}</p></header>
      <article ref={articleRef} tabIndex={0} aria-label={`Texto de ${chapter.title}`} className={`novel-prose novel-font-${preferences.font}`} style={{ fontSize: preferences.fontSize, lineHeight: preferences.lineHeight }}>{paragraphs.map((paragraph, index) => <p key={`${chapter.id}:${index}`} data-paragraph={index}>{paragraph}</p>)}</article>
      {content.attribution && <p className="novel-reader-attribution">{content.attribution}</p>}
      <nav className="novel-reader-chapters" aria-label="Navegação entre capítulos">{content.previousChapterId ? <Link className="novel-reader-button" to={chapterPath(content.previousChapterId)}><ArrowLeft size={17} />Anterior</Link> : <span />}<Link className="novel-reader-button" to={`/novel/${novel.id}`}><List size={17} /><span>Capítulos</span></Link>{content.nextChapterId ? <Link className="novel-reader-button novel-reader-next" to={chapterPath(content.nextChapterId)}>Próximo<ArrowRight size={17} /></Link> : <Link className="novel-reader-button novel-reader-next" to="/novels">Explorar novels<ArrowRight size={17} /></Link>}</nav>
      <p className="novel-reader-help">Use ← e → com o foco no texto para trocar de capítulo.</p>
    </div>
  </main>;
}
