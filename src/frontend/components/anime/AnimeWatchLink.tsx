import { useEffect, useRef } from 'react';
import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import { sourceSuffix } from '../../services/content';
import { prepareAnimeWatch } from '../../services/watchEntry';

type Props = Omit<ComponentProps<typeof Link>, 'to' | 'state' | 'onClick' | 'onPointerEnter' | 'onPointerLeave' | 'onPointerDown' | 'onFocus' | 'onBlur'> & { anime: CatalogAnime; episodeNumber?: number };

/** A normal watch link with intent-based preparation and optional visual continuity. */
export function AnimeWatchLink({ anime, episodeNumber, ...props }: Props) {
  const navigate = useNavigate();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suffix = sourceSuffix({ titles: [anime.title, anime.titleOriginal || ''].filter(Boolean) });
  const to = `/watch/anime/${encodeURIComponent(anime.id)}${suffix}${episodeNumber !== undefined ? `${suffix ? '&' : '?'}episode=${encodeURIComponent(episodeNumber)}` : ''}`;
  const state = { anime, autoPlay: true };
  const cancelPreparation = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  };
  const prepare = () => {
    cancelPreparation();
    void prepareAnimeWatch(anime, episodeNumber);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), [anime.id]);

  return <Link {...props} to={to} state={state}
    onPointerEnter={event => {
      if (event.pointerType === 'touch') return;
      cancelPreparation();
      hoverTimer.current = setTimeout(prepare, 150);
    }}
    onPointerLeave={cancelPreparation}
    onFocus={prepare}
    onBlur={cancelPreparation}
    onPointerDown={event => { if (event.button === 0) prepare(); }}
    onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || (event.currentTarget.target && event.currentTarget.target !== '_self') || event.currentTarget.hasAttribute('download')) return;
      event.preventDefault();
      prepare();
      const open = () => navigate(to, { state });
      if (typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        try {
          const transition = document.startViewTransition(() => flushSync(open));
          void transition.finished.catch(() => undefined);
        } catch { open(); }
      } else open();
    }} />;
}
