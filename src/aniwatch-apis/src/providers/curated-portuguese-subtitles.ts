/** Public subtitle releases reviewed against an exact catalogue and IMDb identity. */
export interface CuratedSubtitleIdentity {
  imdb: string;
  kind: 'movie' | 'series';
  season?: number;
  episode?: number;
}

export interface CuratedPortugueseSubtitle {
  id: string;
  name: string;
  label: string;
  animeId: string;
  imdb: string;
  kind: 'movie' | 'series';
  season?: number;
  episode: number;
  url: string;
  sourceUrl: string;
  format: 'srt' | 'ass' | 'vtt';
  encoding: 'utf-8';
  language: 'pt-BR';
  archive: 'zip';
  machineTranslated?: boolean;
}

// This is a source manifest, not a copy of the subtitle. Fetching uses opaque
// server tickets and the existing public-address-pinned subtitle transport.
const releases: readonly Readonly<CuratedPortugueseSubtitle>[] = Object.freeze([
  Object.freeze({
    id: 'legendei-steins-gate-movie-2013-pt-br',
    name: 'Legendei',
    label: 'Legendei · PT-BR · Steins;Gate (filme)',
    animeId: '11577',
    imdb: 'tt2967286',
    kind: 'movie',
    episode: 1,
    url: 'https://legendei.net/wp-content/uploads/2025/02/PT-BR-SteinsGate-Filme-Load-Region-of-Deja-Vu.zip',
    sourceUrl: 'https://legendei.net/pt-br-steinsgate-filme-load-region-of-deja-vu/',
    format: 'srt',
    encoding: 'utf-8',
    language: 'pt-BR',
    archive: 'zip',
  }),
  Object.freeze({
    id: 'subdl-overgeared-s01e02-pt-br-machine',
    name: 'SubDL',
    label: 'Tradução automática · PT-BR · Overgeared — episódio 2 · SubDL',
    animeId: '212888',
    imdb: 'tt43691353',
    kind: 'series',
    season: 1,
    episode: 2,
    url: 'https://dl.subdl.com/subtitle/3715689-8636848.zip',
    sourceUrl: 'https://subdl.com/s/info/v5sUEYTk84/overgeared',
    format: 'srt',
    encoding: 'utf-8',
    language: 'pt-BR',
    archive: 'zip',
    machineTranslated: true,
  }),
  // Exact S02 files reviewed as UTF-8 ASS with Portuguese dialogue. Missing
  // episodes intentionally have no entry; S01 releases must never fill S02.
  ...([
    [3, '3615025-8532469', 'fCYkx9QZOp'],
    [4, '3619252-8536705', '6h5Si3Z6xS'],
    [6, '3645060-8561441', '9OpI4rMMao'],
    [7, '3653309-8569897', '8T7DnUJtJZ'],
    [8, '3663253-8579912', '2IrnxvjxWH'],
    [9, '3669453-8586306', 'UKTUX8sCQ7'],
    [11, '3682514-8600140', 'FFn33sKB37'],
    [12, '3692105-8610977', 'EKKZhBeUll'],
  ] as const).map(([episode, file, page]) => Object.freeze({
    id: `subdl-clevatess-s02e${String(episode).padStart(2, '0')}-pt-br`,
    name: 'SubDL',
    label: `SubDL · PT-BR · Clevatess — temporada 2, episódio ${episode}`,
    animeId: '198946',
    imdb: 'tt32991344',
    kind: 'series' as const,
    season: 2,
    episode,
    url: `https://dl.subdl.com/subtitle/${file}.zip`,
    sourceUrl: `https://subdl.com/s/info/${page}/clevatess`,
    format: 'ass' as const,
    encoding: 'utf-8' as const,
    language: 'pt-BR' as const,
    archive: 'zip' as const,
  })),
]);

/** Only reviewed exact downloads may use the curated subtitle transport. */
export function permittedCuratedSubtitleUrl(raw: string): URL | undefined {
  let url: URL;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search) return undefined;
  return releases.some(release => release.url === raw && release.url === url.href) ? url : undefined;
}

/** Reviewed exact identities remain available if the remote mapping is down. */
export function curatedSubtitleIdentity(animeId: string, episode: number): CuratedSubtitleIdentity | undefined {
  const release = releases.find(item => item.animeId === animeId && item.episode === episode);
  if (!release) return undefined;
  return release.kind === 'movie' ? { imdb: release.imdb, kind: 'movie' }
    : { imdb: release.imdb, kind: 'series', season: release.season, episode: release.episode };
}

/** No title guessing: AniList, IMDb, media kind and episode identity must agree. */
export function findCuratedPortugueseSubtitles(animeId: string, episode: number, identity: CuratedSubtitleIdentity): CuratedPortugueseSubtitle[] {
  if (!Number.isSafeInteger(episode) || episode < 1) return [];
  return releases.filter(release => release.animeId === animeId && release.episode === episode
    && release.imdb === identity.imdb && release.kind === identity.kind
    && (release.kind === 'movie' ? identity.season === undefined && identity.episode === undefined
      : release.season === identity.season && release.episode === identity.episode)
    && permittedCuratedSubtitleUrl(release.url)).map(release => ({ ...release }));
}

/** Some translated SRT releases flatten ASS drawings into visible dialogue. */
export function sanitizeCuratedSubtitleText(input: string, machineTranslated: boolean): string {
  if (!machineTranslated) return input;
  const text = input.replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  // A drawing must occupy the entire line and begin with an ASS move command
  // followed by two coordinates. Ordinary dialogue and timestamps do not match.
  const coordinate = '[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const drawing = new RegExp(`^m\\s+${coordinate}\\s+${coordinate}(?:\\s+(?:[mnlbspc]|${coordinate}))*$`, 'i');
  return text.split(/\r\n?|\n/).map(line => drawing.test(line.trim()) ? '' : line).join('\n');
}
