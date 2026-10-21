import { useCallback, useState } from 'react';
import { ArrowRight, BookOpen, Loader2, Search, Server } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ContentChapterList, ContentKind } from '../../shared/content';
import { CatalogError } from '../components/ui/CatalogState';
import { contentService, sourceParams, sourceQuery, sourceSuffix } from '../services/content';
import { useCatalogRequest } from '../hooks/useCatalogRequest';

const kinds: Record<ContentKind, string> = { anime: 'Anime', manga: 'Mangá', novel: 'Light novel' };

export function SourcesPage() {
  const [params] = useSearchParams();
  return <SourceForm key={params.toString()} />;
}

function SourceForm() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('kind');
  const initialKind: ContentKind = selected === 'manga' || selected === 'novel' ? selected : 'anime';
  const [kind, setKind] = useState<ContentKind>(initialKind);
  const [id, setId] = useState(params.get('id') || '');
  const [title, setTitle] = useState(params.get('title') || '');
  const [episode, setEpisode] = useState(params.get('episode') || '1');
  const [source, setSource] = useState(params.get('source') || '');
  const [attempt, setAttempt] = useState(0);
  const submitted = params.get('open') === '1';
  const key = params.toString();
  return <main id="main-content" className="page-shell content-width">
    <div className="page-heading"><span className="eyebrow">SUAS FONTES DE CONTEÚDO</span><h1>Assista e leia pelas fontes conectadas.</h1><p>Informe o título e seu ID no AniList para consultar episódios e capítulos diretamente, mesmo quando o catálogo estiver em manutenção.</p></div>
    <form className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-7" onSubmit={event => {
      event.preventDefault();
      const next = new URLSearchParams({ kind, id: id.trim().replace(/^anilist:/, ''), title: title.trim(), open: '1' });
      if (kind === 'anime') next.set('episode', episode);
      if (source) next.set('source', source);
      setParams(next); setAttempt(value => value + 1);
    }}>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr]">
        <label className="grid gap-2 text-sm text-slate-300">Tipo de conteúdo<select className="w-full rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" value={kind} onChange={event => setKind(event.target.value as ContentKind)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-2 text-sm text-slate-300">ID no AniList<input className="w-full rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" required inputMode="numeric" pattern="(?:anilist:)?[1-9][0-9]{0,8}" placeholder="ID da obra" value={id} onChange={event => setId(event.target.value)} /></label>
        <label className="grid gap-2 text-sm text-slate-300">Título da obra<input className="w-full rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" required maxLength={200} placeholder="Nome original ou nome usado pela fonte" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="grid gap-2 text-sm text-slate-300">Fonte<select className="w-full rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" value={source} onChange={event => setSource(event.target.value)}><option value="">Todas as conectadas</option><option value="tatakai">Tatakai local</option><option value="toko">Toko HTTP</option></select></label>
        {kind === 'anime' && <label className="grid gap-2 text-sm text-slate-300">Episódio<input className="w-full rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" required type="number" min={0.001} max={100000} step="0.001" value={episode} onChange={event => setEpisode(event.target.value)} /></label>}
        <div className="flex items-end"><button type="submit" className="button-primary w-full sm:w-auto"><Search size={17} />Consultar fontes</button></div>
      </div>
      <p className="mt-5 text-xs leading-relaxed text-slate-500">O ID está no endereço da obra em anilist.co. A disponibilidade depende das fontes instaladas e do conteúdo retornado por elas.</p>
    </form>
    <div className="mt-5 flex flex-wrap gap-3"><Link className="button-secondary button-sm" to="/sources?kind=anime&id=21&title=One+Piece&source=tatakai&episode=1&open=1">Consultar One Piece · episódio 1<ArrowRight size={15} /></Link><Link className="button-secondary button-sm" to="/sources?kind=novel&id=113869&title=Ascendance+of+a+Bookworm%3A+Part+5&source=tatakai&provider=syosetu&open=1">Consultar Bookworm · texto em japonês<ArrowRight size={15} /></Link><Link className="button-secondary button-sm" to="/sources?kind=manga&id=85143&title=Tower+of+God&source=tatakai&provider=webtoons&open=1">Consultar Tower of God · Webtoons em inglês<ArrowRight size={15} /></Link></div>
    {submitted && <SourceResults key={`${key}:${attempt}`} params={params} />}
    <aside className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 p-5"><div className="flex gap-3"><Server className="mt-1 shrink-0 text-teal-300" size={21} /><div><h2 className="font-semibold text-white">Conexão e disponibilidade</h2><p className="mt-1 text-sm text-slate-400">Confira quais fontes estão respondendo no seu ambiente local.</p></div></div><Link className="button-secondary" to="/providers">Ver fontes<ArrowRight size={16} /></Link></aside>
  </main>;
}

function SourceResults({ params }: { params: URLSearchParams }) {
  const navigate = useNavigate();
  const kind = params.get('kind') as ContentKind;
  const id = params.get('id') || '';
  const serialized = sourceParams(sourceQuery(params)).toString();
  const [retry, setRetry] = useState(0);
  const load = useCallback(async (): Promise<ContentChapterList | null> => {
    const query = sourceQuery(new URLSearchParams(serialized));
    if (kind === 'anime') {
      const playback = await contentService.playback(id, params.get('episode') || '1', query);
      navigate(`/watch/${encodeURIComponent(playback.episode.id)}${sourceSuffix(query)}`, { replace: true });
      return null;
    }
    if (kind !== 'manga' && kind !== 'novel') throw new Error('Escolha anime, mangá ou light novel.');
    return contentService.chapters(kind, id, query);
  }, [id, kind, serialized, params, navigate]);
  const { data, loading, error } = useCatalogRequest(`source:${kind}:${id}:${serialized}:${retry}`, load);
  if (loading) return <div role="status" className="mt-8 flex items-center gap-3 text-slate-300"><Loader2 className="animate-spin text-teal-300" size={20} />Consultando as fontes conectadas…</div>;
  if (error) return <div className="mt-8"><CatalogError message={error} onRetry={() => setRetry(value => value + 1)} /></div>;
  if (!data) return null;
  const query = sourceQuery(params);
  return <section className="mt-9" aria-label="Conteúdo encontrado"><div className="section-heading"><div><h2>{data.available ? `${data.chapters.length} capítulos encontrados` : 'Nenhum capítulo disponível'}</h2><p role="status">{data.message}</p></div></div>
    {data.partial && <p role="status" className="mb-5 text-sm text-amber-200">Algumas fontes não responderam. Os capítulos recebidos estão listados abaixo.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{data.chapters.filter(chapter => chapter.available).map(chapter => {
      const suffix = sourceSuffix({ ...query, provider: chapter.providerId, language: chapter.language });
      const path = kind === 'novel' ? `/novel/${encodeURIComponent(id)}/read/${encodeURIComponent(chapter.id)}` : `/sources/manga/${encodeURIComponent(id)}/read/${encodeURIComponent(chapter.id)}`;
      return <Link key={chapter.id} className="flex min-w-0 items-center gap-4 rounded-xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-teal-400/40" to={`${path}${suffix}`}><BookOpen className="shrink-0 text-teal-300" size={23} /><div className="min-w-0 flex-1"><strong className="block truncate text-sm text-white">{chapter.number ? `${chapter.number} · ` : ''}{chapter.title}</strong><span className="mt-1 block text-xs text-slate-400">{chapter.providerName} · {chapter.language}</span>{chapter.credits.length > 0 && <span className="mt-1 block truncate text-xs text-slate-500">{chapter.credits.join(' · ')}</span>}</div><ArrowRight className="shrink-0 text-slate-400" size={17} /></Link>;
    })}</div>
    {data.diagnostics.length > 0 && <details className="mt-6 rounded-xl border border-white/10 p-4 text-sm text-slate-400"><summary className="cursor-pointer text-slate-300">Resposta das fontes</summary><ul className="mt-3 space-y-2">{data.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.id}:${index}`}>{diagnostic.name || diagnostic.id}: {diagnostic.message}</li>)}</ul></details>}
  </section>;
}
