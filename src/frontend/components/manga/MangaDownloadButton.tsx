import { useEffect, useId, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { createMangaArchive } from '../../services/mangaDownload';
import type { MangaDownloadInput, MangaDownloadProgress } from '../../services/mangaDownload';
import '../../manga.css';

interface Props {
  load: () => Promise<MangaDownloadInput>;
  label?: string;
}

export function MangaDownloadButton({ load, label = 'Baixar CBZ' }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MangaDownloadProgress>();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const statusId = useId();

  useEffect(() => () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setProgress(undefined);
    setFailed(false);
    setMessage('Download cancelado. Nenhum arquivo parcial foi salvo.');
  };

  const download = async () => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setProgress(undefined);
    setFailed(false);
    setMessage('Preparando capítulo…');
    try {
      const input = await load();
      controller.signal.throwIfAborted();
      const archive = await createMangaArchive(input, {
        signal: controller.signal,
        onProgress: value => {
          if (controllerRef.current === controller) setProgress(value);
        },
      });
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(archive.blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = archive.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        // Give browsers time to consume the archive before releasing its bytes.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setMessage('Download iniciado. Abra o CBZ no seu leitor de quadrinhos.');
    } catch (error) {
      if (controllerRef.current !== controller) return;
      if (controller.signal.aborted) setMessage('Download cancelado. Nenhum arquivo parcial foi salvo.');
      else {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'Não foi possível baixar o capítulo. Tente novamente.');
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
        setProgress(undefined);
      }
    }
  };

  return <div className="manga-download">
    <div className="manga-download-controls">
      <button type="button" className="button-secondary manga-download-button" aria-label={label} aria-describedby={statusId} disabled={busy} onClick={() => void download()}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
        {busy ? 'Preparando CBZ…' : 'Baixar CBZ'}
      </button>
      {busy && <button type="button" className="manga-download-cancel" aria-label="Cancelar download" onClick={cancel}><X size={16} aria-hidden="true" />Cancelar</button>}
    </div>
    <p id={statusId} className={`manga-download-status${failed ? ' manga-download-error' : ''}`} role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'} aria-atomic="true">
      {busy && progress ? `Baixando páginas: ${progress.completed} de ${progress.total}…` : message}
    </p>
  </div>;
}
