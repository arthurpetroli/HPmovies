import { useEffect, useId, useState } from 'react';
import { Download, FolderArchive, Loader2, X } from 'lucide-react';
import type { MangaArchiveJob, MangaArchivePlan } from '../../../shared/mangaArchive';
import { mangaArchiveService } from '../../services/mangaArchive';

const active = (job: MangaArchiveJob | null) => !!job && (job.state === 'queued' || job.state === 'downloading');
const storageKey = (id: string, language: string) => `hpmovies.manga-archive:${id}:${language}`;
function remembered(id: string, language: string) {
  try { const value = localStorage.getItem(storageKey(id, language)); return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null; } catch { return null; }
}

export function MangaArchivePanel({ mangaId, language }: { mangaId: string; language: string }) {
  return <ArchivePanel key={`${mangaId}:${language}`} mangaId={mangaId} language={language} />;
}
function ArchivePanel({ mangaId, language }: { mangaId: string; language: string }) {
  const [jobId, setJobId] = useState(() => remembered(mangaId, language));
  const [expanded, setExpanded] = useState(!!jobId);
  const [plan, setPlan] = useState<MangaArchivePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [job, setJob] = useState<MangaArchiveJob | null>(null);
  const [volumeIndex, setVolumeIndex] = useState(0);
  const [error, setError] = useState('');
  const [pollRetry, setPollRetry] = useState(0);
  const panelId = useId();
  const specificLanguage = language !== 'pt' && language !== 'all';
  const remember = (value: string | null) => {
    setJobId(value);
    try { if (value) localStorage.setItem(storageKey(mangaId, language), value); else localStorage.removeItem(storageKey(mangaId, language)); } catch { /* The current download remains accessible in this tab. */ }
  };

  useEffect(() => {
    if (!jobId) return;
    let mounted = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await mangaArchiveService.status(jobId);
        if (!mounted) return;
        setJob(next); setError('');
        if (active(next)) timer = setTimeout(() => void poll(), 1500);
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o andamento.');
      }
    };
    void poll();
    // Whole-work jobs continue on the local server while the reader is open.
    return () => { mounted = false; clearTimeout(timer); };
  }, [jobId, pollRetry]);

  const loadPlan = async () => {
    setLoading(true); setError('');
    try {
      const next = await mangaArchiveService.plan(mangaId, language);
      if (next.mangaId !== mangaId || next.language.toLowerCase() !== language.toLowerCase()) throw new Error('A lista de download pertence a outra obra ou idioma.');
      setPlan(next); setVolumeIndex(0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível listar os volumes.'); }
    finally { setLoading(false); }
  };
  const start = async (scope: 'all' | 'volume') => {
    setWorking(true); setError('');
    try {
      if (jobId) { await mangaArchiveService.cancel(jobId).catch(() => undefined); setJob(null); remember(null); }
      const next = await mangaArchiveService.start({ mangaId, language, scope, ...(scope === 'volume' ? { volume: plan!.volumes[volumeIndex].volume } : {}) });
      setJob(next); remember(next.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o download.'); }
    finally { setWorking(false); }
  };
  const cancel = async () => {
    if (!jobId) return;
    setWorking(true); setError('');
    try { setJob(await mangaArchiveService.cancel(jobId)); remember(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível cancelar o download.'); }
    finally { setWorking(false); }
  };
  return <section className="manga-archive" aria-label="Download por volumes">
    <div className="manga-archive-heading"><FolderArchive size={25} aria-hidden="true" /><div><h2>Seu mangá, organizado para ler offline</h2><p>Baixe um volume ou todos os capítulos disponíveis em ZIP, com pastas por volume e capítulo.</p></div></div>
    <button type="button" className="button-secondary" aria-expanded={expanded} aria-controls={panelId} onClick={() => { setExpanded(value => !value); if (!expanded && !plan && specificLanguage) void loadPlan(); }}>Ver volumes e baixar mangá inteiro</button>
    {expanded && <div id={panelId} className="manga-archive-body">
      {!specificLanguage ? <p>Escolha um idioma específico, como português brasileiro, na lista de capítulos para preparar o ZIP.</p> : <>
        {loading && <p role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Buscando todos os capítulos e volumes…</p>}
        {!loading && !plan && <button type="button" className="button-secondary" onClick={() => void loadPlan()}>Carregar volumes</button>}
        {plan && <>
          <p><strong>{plan.chapters.length} capítulos disponíveis</strong> em {plan.volumes.length} {plan.volumes.length === 1 ? 'pasta de volume' : 'pastas de volume'}. O ZIP guarda as imagens em ordem e os créditos de cada capítulo.</p>
          {plan.warnings.map(warning => <p className="manga-archive-warning" key={warning}>{warning}</p>)}
          <div className="manga-archive-selection"><label>Volume para baixar<select value={volumeIndex} onChange={event => setVolumeIndex(Number(event.target.value))} disabled={working || active(job)}>{plan.volumes.map((volume, index) => <option key={index} value={index}>{volume.volume === null ? 'Volume não informado' : `Volume ${volume.volume}`} · {volume.chapters} capítulos</option>)}</select></label><button type="button" className="button-secondary" disabled={!plan.volumes.length || working || active(job)} onClick={() => void start('volume')}><Download size={16} aria-hidden="true" />Baixar volume</button><button type="button" className="button-primary" disabled={!plan.chapters.length || working || active(job)} onClick={() => void start('all')}><FolderArchive size={16} aria-hidden="true" />Baixar mangá inteiro</button></div>
          <pre className="manga-archive-tree" aria-label="Estrutura de pastas do ZIP">{`${plan.title}/\n  ${plan.volumes[volumeIndex]?.volume == null ? 'Volume não informado' : `Volume ${plan.volumes[volumeIndex].volume}`}/\n    Capítulo ${plan.chapters.find(chapter => chapter.volume === plan.volumes[volumeIndex]?.volume)?.chapter ?? 'extra'}/\n      Páginas numeradas em ordem`}</pre>
          <p>Os volumes seguem os dados do provedor. Quando faltam, os capítulos ficam em “Volume não informado”.</p>
          <p>Limite por ZIP: 20 GiB e 50 mil páginas. Mantenha o servidor local ligado até terminar a preparação.</p>
        </>}
      </>}
      {job && <div className="manga-archive-progress" aria-label="Andamento do download">
        <p role="status" aria-live="polite">{job.message}</p>
        {!!job.totalChapters && <><progress value={job.completedChapters} max={job.totalChapters} aria-label="Capítulos preparados" /><p>{job.completedChapters} de {job.totalChapters} capítulos · {job.completedPages} páginas · {(job.bytes / 1024 ** 2).toFixed(1)} MB</p></>}
        {active(job) && <p>Você pode continuar lendo. A preparação continua no servidor local enquanto ele estiver ligado.</p>}
        {job.state === 'ready' && <a className="button-primary" href={mangaArchiveService.fileUrl(job.id)} download><Download size={17} aria-hidden="true" />Salvar ZIP com volumes</a>}
        {(active(job) || job.state === 'ready') && <button type="button" className="button-secondary" disabled={working} onClick={() => void cancel()}><X size={16} aria-hidden="true" />{job.state === 'ready' ? 'Descartar arquivo preparado' : 'Cancelar download do mangá'}</button>}
      </div>}
      {error && <div className="manga-archive-error" role="alert"><p>{error}</p>{jobId && <button type="button" className="button-secondary" onClick={() => setPollRetry(value => value + 1)}>Atualizar andamento</button>}</div>}
    </div>}
  </section>;
}
