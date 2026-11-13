import type { ExternalSubtitleLanguage } from '../../../shared/externalSubtitles.js';

/** Explicit OpenSubtitles ISO 639-2/B codes; browser input cannot become an arbitrary filter. */
const LANGUAGES = [
  ['pt-BR', 'Português (Brasil)', 'pob'], ['pt', 'Português (Portugal)', 'por'],
  ['en', 'Inglês', 'eng'], ['es', 'Espanhol', 'spa'], ['ar', 'Árabe', 'ara'], ['fr', 'Francês', 'fre'],
  ['sq', 'Albanês', 'alb'], ['hy', 'Armênio', 'arm'], ['bn', 'Bengali', 'ben'], ['bg', 'Búlgaro', 'bul'],
  ['zh-Hans', 'Chinês (simplificado)', 'chi'], ['zh-Hant', 'Chinês (tradicional)', 'zht'],
  ['hr', 'Croata', 'hrv'], ['cs', 'Tcheco', 'cze'], ['da', 'Dinamarquês', 'dan'],
  ['nl', 'Holandês', 'dut'], ['et', 'Estoniano', 'est'], ['fi', 'Finlandês', 'fin'],
  ['ka', 'Georgiano', 'geo'], ['de', 'Alemão', 'ger'], ['el', 'Grego', 'ell'],
  ['he', 'Hebraico', 'heb'], ['hi', 'Hindi', 'hin'], ['hu', 'Húngaro', 'hun'],
  ['is', 'Islandês', 'ice'], ['id', 'Indonésio', 'ind'], ['it', 'Italiano', 'ita'],
  ['ja', 'Japonês', 'jpn'], ['ko', 'Coreano', 'kor'], ['lv', 'Letão', 'lav'],
  ['lt', 'Lituano', 'lit'], ['mk', 'Macedônio', 'mac'], ['ms', 'Malaio', 'may'],
  ['no', 'Norueguês', 'nor'], ['fa', 'Persa', 'per'], ['pl', 'Polonês', 'pol'],
  ['ro', 'Romeno', 'rum'], ['ru', 'Russo', 'rus'], ['sr', 'Sérvio', 'scc'],
  ['sk', 'Eslovaco', 'slo'], ['sl', 'Esloveno', 'slv'], ['sv', 'Sueco', 'swe'],
  ['ta', 'Tâmil', 'tam'], ['te', 'Télugo', 'tel'], ['th', 'Tailandês', 'tha'],
  ['tr', 'Turco', 'tur'], ['uk', 'Ucraniano', 'ukr'], ['vi', 'Vietnamita', 'vie'],
] as const;

export const externalSubtitleLanguages: readonly ExternalSubtitleLanguage[] = LANGUAGES.map(([id, label]) => ({ id, label }));

export function subtitleLanguage(input: string): { id: string; iso: string } | undefined {
  if (typeof input !== 'string') return undefined;
  const language = LANGUAGES.find(([id]) => id.toLowerCase() === input.toLowerCase());
  return language ? { id: language[0], iso: language[2] } : undefined;
}

export function languageFromOpenSubtitles(input: unknown): string | undefined {
  return LANGUAGES.find(([, , iso]) => iso === input)?.[0];
}

/** Decode known text encodings only. Unsupported source declarations stay unavailable. */
export function subtitleEncoding(input: unknown): string | undefined {
  if (input === undefined) return 'utf-8';
  if (typeof input !== 'string' || input.length > 40) return undefined;
  const name = input.toLowerCase().trim().replace(/_/g, '-');
  if (name === 'utf8') return 'utf-8';
  if (/^cp125[0-8]$/.test(name)) return name.replace('cp', 'windows-');
  if (/^(?:utf-8|utf-16|utf-16le|utf-16be|windows-125[0-8]|iso-8859-(?:1|2|3|4|5|6|7|8|9|10|13|14|15|16)|koi8-r|koi8-u|shift-jis|euc-jp|euc-kr|gb18030|big5)$/.test(name)) {
    try { new TextDecoder(name); return name; } catch { return undefined; }
  }
  return undefined;
}
