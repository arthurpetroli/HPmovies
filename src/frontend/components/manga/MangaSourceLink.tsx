import { ExternalLink } from 'lucide-react';

export function MangaSourceLink({ href, label = 'Abrir no provedor', ariaLabel, className = 'manga-source' }: { href?: string; label?: string; ariaLabel?: string; className?: string }) {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
  } catch { return null; }
  return <a className={className} href={href} aria-label={ariaLabel} target="_blank" rel="noopener noreferrer" title="Abre em outra aba">{label}<ExternalLink size={15} aria-hidden="true" /></a>;
}
