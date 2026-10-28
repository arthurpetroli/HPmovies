import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { setWatchPreference, useWatchPreferences } from '../../services/watchPreferences';

export function InterfaceSettings({ onClose, navigationExpanded, onToggleNavigation }: { onClose: () => void; navigationExpanded: boolean; onToggleNavigation: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preferences = useWatchPreferences();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="interface-settings" aria-labelledby="interface-settings-title" onClose={event => { if (!event.currentTarget.open) onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="interface-settings-content"><header><h2 id="interface-settings-title">Sua experiência</h2><button type="button" aria-label="Fechar configurações" onClick={onClose}><X size={22} aria-hidden="true" /></button></header>
      <p>Do seu jeito, neste navegador.</p>
      <fieldset><legend>Aparência</legend>
        <label><span><strong>Fundo com arte do anime</strong><small>A imagem acompanha o anime no player e nos detalhes.</small></span><input type="checkbox" checked={preferences.ambient} onChange={event => setWatchPreference('ambient', event.target.checked)} /></label>
        <label className="settings-navigation-choice"><span><strong>Menu lateral expandido</strong><small>Exibe os nomes junto aos ícones.</small></span><input type="checkbox" checked={navigationExpanded} onChange={onToggleNavigation} /></label>
      </fieldset>
      <fieldset><legend>Reprodução</legend>
        <label><span><strong>Avançar ao terminar</strong><small>Abre o próximo episódio depois do fim do vídeo.</small></span><input type="checkbox" checked={preferences.autoNext} onChange={event => setWatchPreference('autoNext', event.target.checked)} /></label>
        <label><span><strong>Pular abertura automaticamente</strong><small>Funciona quando o episódio tem tempos de abertura identificados.</small></span><input type="checkbox" checked={preferences.autoSkipIntro} onChange={event => setWatchPreference('autoSkipIntro', event.target.checked)} /></label>
      </fieldset>
      <p className="settings-footnote">Progresso, lista e preferências ficam salvos neste navegador. Animações respeitam a preferência de movimento reduzido do sistema.</p>
    </div>
  </dialog>;
}
