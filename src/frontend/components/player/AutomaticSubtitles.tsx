import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { StreamSubtitle } from '../../../shared/providers';
import { automaticSubtitleService } from '../../services/automaticSubtitles';

export function AutomaticSubtitles({ tracks, onReady }: { tracks: StreamSubtitle[]; onReady: (track: StreamSubtitle) => void }) {
  const candidates = tracks.filter(track => track.translationToken);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  if (!candidates.length || tracks.some(track => track.machineTranslated)) return null;

  const generate = async () => {
    const track = candidates.find(item => item.id === selected) ?? candidates[0];
    if (!track.translationToken || busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true); setError(''); setMessage('Traduzindo para português. Você pode continuar assistindo.');
    try {
      let job = await automaticSubtitleService.start(track.translationToken, controller.signal);
      const deadline = Date.now() + 6 * 60_000;
      while (job.state === 'pending') {
        if (Date.now() > deadline) throw new Error('A tradução demorou demais. Tente novamente em instantes.');
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 2000);
          if (controller.signal.aborted) abort();
          else controller.signal.addEventListener('abort', abort, { once: true });
        });
        job = await automaticSubtitleService.status(job.id, controller.signal);
      }
      if (job.state !== 'complete' || !job.subtitle) throw new Error(job.message || 'Não foi possível traduzir esta faixa.');
      controller.signal.throwIfAborted();
      onReady(job.subtitle);
      setMessage('Legenda automática pronta.');
    } catch (cause) {
      if (!controller.signal.aborted) { setMessage(''); setError(cause instanceof Error ? cause.message : 'Falha ao traduzir a legenda.'); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <div className="mt-5 border-t border-white/10 pt-5">
    <h3 className="text-sm font-semibold text-white">Legenda automática</h3>
    <p className="mt-2 text-xs leading-relaxed text-slate-400">Traduz uma legenda existente para português. Pode levar alguns minutos e conter erros.</p>
    <label className="mt-3 block"><span className="mb-2 block text-xs text-slate-400">Legenda de origem</span>
      <select disabled={busy} value={selected || candidates[0].id} onChange={event => setSelected(event.target.value)} className="w-full min-w-0 rounded-lg border border-white/15 bg-[#151d25] px-3 py-2.5 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-60">
        {candidates.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}
      </select>
    </label>
    <button type="button" disabled={busy} onClick={() => { void generate(); }} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-400 px-3 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-wait disabled:opacity-60">
      {busy && <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{busy ? 'Traduzindo legenda…' : 'Gerar legenda em português'}
    </button>
    {message && <p role="status" className="mt-3 text-xs leading-relaxed text-slate-300">{message}</p>}
    {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-amber-200">{error}</p>}
  </div>;
}
