import type { AnimeStreamingProvider, Playback, ProviderDiagnostic, StreamingAvailability } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { integrationsConfig } from '../config/integrations.js';
import type { TatakaiConfig, TokoConfig } from '../config/integrations.js';
import { TokoHttpClient } from './toko-http.js';
import { TokoStreamingProvider } from './toko.js';

interface TatakaiOptions { client?: TokoHttpClient }

/** The documented local extension host from Tatakai, rather than its unrelated public website API. */
export class TatakaiStreamingProvider implements AnimeStreamingProvider {
  readonly client: TokoHttpClient;
  readonly contentConfig: TokoConfig;
  private readonly adapter: TokoStreamingProvider;

  constructor(readonly config: TatakaiConfig = integrationsConfig.tatakai, options: TatakaiOptions = {}) {
    this.contentConfig = {
      enabled: config.enabled,
      baseUrl: config.baseUrl ?? 'http://127.0.0.1:8099',
      timeoutMs: config.timeoutMs ?? 8000,
      retries: config.retries ?? 0,
      contentAuthorized: config.contentAuthorized ?? false,
      allowedProviders: config.allowedProviders ?? [],
      allowedMediaHosts: config.allowedMediaHosts ?? [],
      allowedRequestOrigins: config.allowedRequestOrigins ?? [],
    };
    this.client = options.client ?? new TokoHttpClient(this.contentConfig, { apiMode: 'extension-host', namespace: config.namespace ?? 'toko' });
    this.adapter = new TokoStreamingProvider({ client: this.client, config: this.contentConfig, id: 'tatakai', name: 'Tatakai local' });
  }

  async diagnostic(): Promise<ProviderDiagnostic> {
    const base: ProviderDiagnostic = {
      id: 'tatakai', name: 'Tatakai local', enabled: this.config.enabled,
      state: 'unavailable', technicalAvailable: false,
      authorized: this.contentConfig.contentAuthorized && this.contentConfig.allowedProviders.length > 0,
      checkedAt: new Date().toISOString(),
      message: 'Host de extensões Tatakai desativado.', capabilities: ['extension-host'],
    };
    if (!this.config.enabled) return base;
    // A legacy URL without a declared namespace is not a verified content contract.
    if (!this.config.namespace) return { ...base, state: 'unauthorized', message: 'Configure o host local e um namespace de extensão compatível; api.tatakai.me não é o host de conteúdo.' };
    try {
      const health = await this.client.health();
      base.technicalAvailable = health.ok;
      if (!health.ok) return { ...base, message: 'O host de extensões não está saudável.' };
      if (!health.toko) return { ...base, message: `O host Tatakai está ativo, mas não possui uma extensão compatível no namespace “${this.config.namespace}”. Configure um pacote local confiável para fornecer conteúdo.` };
      const stream = await this.adapter.diagnostic();
      return { ...stream, id: 'tatakai', name: 'Tatakai local', technicalAvailable: true, capabilities: ['extension-host', 'anime-streams', 'manga-chapters', 'manga-pages', 'novel-chapters', 'novel-text'] };
    } catch (error) {
      return { ...base, state: 'connection_error', message: error instanceof ApiError ? error.message : 'Não foi possível conectar ao host local Tatakai.' };
    }
  }

  async episodes(animeId: string, titles?: string[]): Promise<StreamingAvailability> {
    const diagnostic = await this.diagnostic();
    if (diagnostic.state !== 'available') return { available: false, episodes: [], state: diagnostic.state, message: diagnostic.message, diagnostics: [diagnostic] };
    return this.adapter.episodes(animeId, titles);
  }

  async playback(episodeId: string, titles?: string[]): Promise<Playback> {
    if (!this.config.enabled || !this.config.namespace) throw new ApiError(503, 'TATAKAI_UNAVAILABLE', 'Configure um host local Tatakai e seu namespace para resolver a reprodução.');
    return this.adapter.playback(episodeId, titles);
  }
}
