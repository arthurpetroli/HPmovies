import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { setWatchPreference, useWatchPreferences } from '../../services/watchPreferences';
import { setAdultMode, useAdultMode } from '../../services/adultMode';
import { adultService } from '../../services/adult';

export function InterfaceSettings({ onClose, navigationExpanded, onToggleNavigation }: { onClose: () => void; navigationExpanded: boolean; onToggleNavigation: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preferences = useWatchPreferences();
  const adult = useAdultMode();
  const [confirming, setConfirming] = useState(false);
  // null while the backend answers; an unreachable backend does not lock the switch.
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let active = true;
    adultService.status().then(status => { if (active) setServerEnabled(status.enabled); }).catch(() => { if (active) setServerEnabled(null); });
    return () => { active = false; };
  }, []);
  const serverDisabled = serverEnabled === false;
  return <dialog ref={dialog} className="interface-settings" aria-labelledby="interface-settings-title" onClose={event => { if (!event.currentTarget.open) onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="interface-settings-content"><header><h2 id="interface-settings-title">Sua experiência</h2><button type="button" aria-label="Fechar configurações" onClick={onClose}><X size={22} aria-hidden="true" /></button></header>
      <p>Do seu jeito, neste navegador.</p>
      <fieldset><legend>Aparência</legend>
        <label><span><strong>Fundo com arte do anime</strong><small>A arte do anime ilumina o início, os detalhes e o player.</small></span><input type="checkbox" checked={preferences.ambient} onChange={event => setWatchPreference('ambient', event.target.checked)} /></label>
        <label className="settings-navigation-choice"><span><strong>Menu lateral expandido</strong><small>Exibe os nomes junto aos ícones.</small></span><input type="checkbox" checked={navigationExpanded} onChange={onToggleNavigation} /></label>
      </fieldset>
      <fieldset><legend>Reprodução</legend>
        <label><span><strong>Avançar ao terminar</strong><small>Abre o próximo episódio depois do fim do vídeo.</small></span><input type="checkbox" checked={preferences.autoNext} onChange={event => setWatchPreference('autoNext', event.target.checked)} /></label>
        <label><span><strong>Pular abertura automaticamente</strong><small>Funciona quando o episódio tem tempos de abertura identificados.</small></span><input type="checkbox" checked={preferences.autoSkipIntro} onChange={event => setWatchPreference('autoSkipIntro', event.target.checked)} /></label>
      </fieldset>
      <fieldset><legend>Conteúdo adulto</legend>
        <label><span><strong>Mostrar conteúdo adulto (18+)</strong><small>Libera a seção Adulto no menu, com hentai do AniList e as fontes configuradas. Obras que retratam menores continuam bloqueadas.</small></span>
          <input type="checkbox" checked={adult.enabled || confirming} disabled={serverDisabled && !adult.enabled} aria-describedby={serverDisabled ? 'adult-server-note' : undefined} onChange={event => {
            if (event.target.checked) { setConfirming(true); return; }
            setConfirming(false);
            setAdultMode(false);
          }} />
        </label>
        {confirming && !adult.enabled && <div className="settings-adult-confirm" role="group" aria-labelledby="adult-confirm-title">
          <p><strong id="adult-confirm-title">Confirme sua idade</strong>Esta seção contém material sexual explícito. Ative somente se você tem 18 anos ou mais e se esse conteúdo é permitido onde você está.</p>
          <div className="settings-adult-actions">
            <button type="button" className="button-primary" autoFocus onClick={() => { setAdultMode(true); setConfirming(false); }}>Tenho 18 anos ou mais</button>
            <button type="button" className="button-secondary" onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        </div>}
        {serverDisabled && <p id="adult-server-note" className="settings-note">O servidor está com o conteúdo adulto desativado. Defina ADULT_CONTENT_ENABLED=true no .env do backend e reinicie.</p>}
      </fieldset>
      <p className="settings-footnote">Progresso, lista e preferências ficam salvos neste navegador. O conteúdo adulto não entra no histórico nem na sua lista. Animações respeitam a preferência de movimento reduzido do sistema.</p>
    </div>
  </dialog>;
}
