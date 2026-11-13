import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronRight, Languages, Loader2, RefreshCw, X } from 'lucide-react';
import type { ExternalSubtitleLanguage, ExternalSubtitleOption } from '../../../shared/externalSubtitles';
import { searchExternalSubtitles } from '../../services/externalSubtitles';
import { useCatalogRequest } from '../../hooks/useCatalogRequest';
import './externalSubtitlePicker.css';

const COMMON_LANGUAGES: ExternalSubtitleLanguage[] = [
  { id: 'pt-BR', label: 'Português (Brasil)' }, { id: 'pt', label: 'Português (Portugal)' },
  { id: 'en', label: 'Inglês' }, { id: 'es', label: 'Espanhol' }, { id: 'ar', label: 'Árabe' }, { id: 'fr', label: 'Francês' },
];

interface Props {
  episodeId: string;
  selectedId?: string;
  onSelect: (track: ExternalSubtitleOption) => void;
  onClose: () => void;
}

export function ExternalSubtitlePicker({ episodeId, selectedId, onSelect, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [view, setView] = useState<'languages' | 'versions'>('languages');
  const [language, setLanguage] = useState('pt-BR');
  const [attempt, setAttempt] = useState(0);
  const loader = useCallback(() => searchExternalSubtitles(episodeId, language), [episodeId, language]);
  const { data, loading, error } = useCatalogRequest(`external-subtitles:${episodeId}:${language}:${attempt}`, loader);
  const languages = [...(data?.languages || COMMON_LANGUAGES)].sort((a, b) => Number(b.id === 'pt-BR') - Number(a.id === 'pt-BR'));
  const languageLabel = languages.find(item => item.id === language)?.label || language;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<dialog ref={dialogRef} className="external-subtitle-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')]
        .filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="external-subtitle-heading">
      {view === 'versions' && <button type="button" className="external-subtitle-icon" aria-label="Voltar aos idiomas" onClick={() => setView('languages')}><ArrowLeft size={19} aria-hidden="true" /></button>}
      <h2 id={titleId}>OpenSubtitles</h2>
      <button ref={closeRef} type="button" className="external-subtitle-icon" aria-label="Fechar busca de legendas" onClick={onClose}><X size={19} aria-hidden="true" /></button>
    </header>
    <div className="external-subtitle-content">
      {view === 'languages' ? <>
        <p className="external-subtitle-description">Escolha um idioma para ver as versões disponíveis.</p>
        {loading && <p role="status" className="external-subtitle-status"><Loader2 size={17} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Consultando o OpenSubtitles…</p>}
        <ul className="external-subtitle-list" aria-label="Idiomas do OpenSubtitles">{languages.map(item => <li key={item.id}>
          <button type="button" className="external-subtitle-row" onClick={() => { setLanguage(item.id); setView('versions'); }}>
            <Languages size={19} aria-hidden="true" /><span>{item.label}</span><ChevronRight size={18} aria-hidden="true" />
          </button>
        </li>)}</ul>
      </> : <>
        <h3 className="external-subtitle-language">{languageLabel}</h3>
        {loading ? <p role="status" className="external-subtitle-status"><Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Buscando versões de legenda…</p>
          : error ? <div role="alert" className="external-subtitle-state"><p>{error}</p><button type="button" className="button-secondary min-h-11" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Tentar novamente</button></div>
            : !data?.subtitles.length ? <div role="status" className="external-subtitle-state"><p>Nenhuma legenda em {languageLabel.toLocaleLowerCase('pt-BR')} foi encontrada para este vídeo.</p><button type="button" className="button-secondary min-h-11" onClick={() => setView('languages')}>Escolher outro idioma</button></div>
              : <ul className="external-subtitle-list" aria-label="Versões de legenda">{data.subtitles.map(track => <li key={track.id}>
                <button type="button" className="external-subtitle-row external-subtitle-version" aria-pressed={selectedId === track.id} onClick={() => onSelect(track)}>
                  <span><strong>{track.release}</strong><small>{track.sourceFormat.toUpperCase()}{track.downloads !== undefined ? ` · ${track.downloads.toLocaleString('pt-BR')} downloads` : ''}{selectedId === track.id ? ' · Selecionada' : ''}</small>{track.translationToken ? <small>Após selecionar, você pode traduzir esta versão para português com IA.</small> : track.translationMessage && <small>{track.translationMessage}</small>}</span>
                  {selectedId === track.id && <Check size={19} aria-hidden="true" />}
                </button>
              </li>)}</ul>}
        {data?.message && <p className="external-subtitle-description mt-4" role="status">{data.message}</p>}
      </>}
    </div>
    <footer className="external-subtitle-footer">A versão escolhida pode exigir ajuste de sincronização nas configurações do player.</footer>
  </dialog>, document.fullscreenElement || document.body);
}
