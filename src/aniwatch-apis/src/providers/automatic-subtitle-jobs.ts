import { randomUUID } from 'node:crypto';
import type { AutomaticSubtitleJob, Playback, StreamSubtitle } from '../../../shared/providers.js';
import { subtitleToVtt } from '../../../shared/subtitles.js';
import { ApiError } from '../config/apiError.js';
import { AutomaticSubtitleProvider } from './automatic-subtitles.js';

interface Offer { track: StreamSubtitle; key: string; expires: number; job?: string }
interface StoredJob { value: AutomaticSubtitleJob; expires: number }
interface Options {
  translator?: AutomaticSubtitleProvider;
  load: (path: string) => Promise<Uint8Array>;
  now?: () => number;
}

/** Translation inputs are issued alongside playback; requests cannot supply URLs or text. */
export class AutomaticSubtitleJobs {
  readonly translator: AutomaticSubtitleProvider;
  private readonly offers = new Map<string, Offer>();
  private readonly offerKeys = new Map<string, string>();
  private readonly jobs = new Map<string, StoredJob>();
  private active = 0;
  private readonly now: () => number;
  constructor(private readonly options: Options) {
    this.translator = options.translator ?? new AutomaticSubtitleProvider();
    this.now = options.now ?? Date.now;
  }

  private prune() {
    for (const [key, offer] of this.offers) if (offer.expires <= this.now()) {
      this.offers.delete(key);
      if (this.offerKeys.get(offer.key) === key) this.offerKeys.delete(offer.key);
    }
    for (const [key, job] of this.jobs) if (job.expires <= this.now() && job.value.state !== 'pending') this.jobs.delete(key);
  }

  async offer(playback: Playback): Promise<Playback> {
    const availability = await this.translator.availability().catch(() => ({ available: false, sourceLanguages: [] as string[] }));
    if (!availability.available || playback.isDemo) return playback;
    this.prune();
    const attach = (tracks: StreamSubtitle[]) => tracks.map(track => {
      const language = track.language.toLowerCase().replace(/_/g, '-').split('-')[0];
      if (track.machineTranslated || /\b(?:forced|signs|songs)\b/i.test(track.label) || language === 'pt' || !availability.sourceLanguages.includes(language)
        || !/^\/api\/(?:streaming\/media|subtitles\/file)\/[a-zA-Z0-9_-]+$/.test(track.url)) return track;
      const key = JSON.stringify([playback.episode.id, track.url, language, track.format]);
      let token = this.offerKeys.get(key);
      if (!token) {
        if (this.offers.size >= 2048) return track;
        token = randomUUID();
        this.offers.set(token, { track: { ...track, language }, key, expires: this.now() + 60 * 60_000 });
        this.offerKeys.set(key, token);
      }
      return { ...track, translationToken: token };
    });
    // Unscoped captions belong only to the primary source, as in the player.
    return { ...playback, subtitles: attach(playback.subtitles), sources: playback.sources.map(source => ({ ...source,
      ...(source.subtitles ? { subtitles: attach(source.subtitles) } : {}),
    })) };
  }

  start(token: string): AutomaticSubtitleJob {
    this.prune();
    const offer = this.offers.get(token);
    if (!offer) throw new ApiError(404, 'SUBTITLE_TRANSLATION_EXPIRED', 'A opção de tradução expirou. Reabra o episódio.');
    if (offer.job) {
      const existing = this.jobs.has(offer.job) ? this.status(offer.job) : undefined;
      if (existing && existing.state !== 'failed') return existing;
    }
    if (this.active >= 2) throw new ApiError(503, 'SUBTITLE_TRANSLATION_BUSY', 'Há legendas sendo traduzidas. Tente novamente em instantes.');
    while (this.jobs.size >= 256) {
      const finished = [...this.jobs].find(([, item]) => item.value.state !== 'pending');
      if (!finished) break;
      this.jobs.delete(finished[0]);
    }
    const value: AutomaticSubtitleJob = { id: randomUUID(), state: 'pending' };
    this.jobs.set(value.id, { value, expires: this.now() + 60 * 60_000 });
    offer.job = value.id;
    this.active++;
    void this.options.load(offer.track.url).then(bytes => {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return this.translator.translate(subtitleToVtt(text, offer.track.format ?? 'vtt'), offer.track.language);
    }).then(subtitle => {
      this.jobs.set(value.id, { value: { id: value.id, state: 'complete', subtitle }, expires: this.now() + 60 * 60_000 });
    }).catch((error: unknown) => {
      this.jobs.set(value.id, { value: { id: value.id, state: 'failed', message: error instanceof ApiError ? error.message : 'Não foi possível traduzir esta faixa. Tente outra legenda.' }, expires: this.now() + 10 * 60_000 });
    }).finally(() => { this.active--; });
    return value;
  }

  status(id: string): AutomaticSubtitleJob {
    this.prune();
    const job = this.jobs.get(id);
    if (!job) throw new ApiError(404, 'SUBTITLE_TRANSLATION_EXPIRED', 'Esta tradução expirou. Gere a legenda novamente.');
    if (job.value.state === 'complete' && job.value.subtitle) {
      try { this.translator.file(job.value.subtitle.url.split('/').at(-1)!); }
      catch { job.value = { id, state: 'failed', message: 'O arquivo da tradução expirou. Gere a legenda novamente.' }; }
    }
    return job.value;
  }
}
