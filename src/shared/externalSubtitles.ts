import type { StreamSubtitle } from './providers.js';

export interface ExternalSubtitleLanguage {
  id: string;
  label: string;
}

export interface ExternalSubtitleOption extends StreamSubtitle {
  release: string;
  sourceFormat: 'srt' | 'ass' | 'vtt';
  downloads?: number;
  provider: 'opensubtitles';
}

export interface ExternalSubtitleSearch {
  episodeId: string;
  language: string;
  languages: ExternalSubtitleLanguage[];
  subtitles: ExternalSubtitleOption[];
  message?: string;
}
