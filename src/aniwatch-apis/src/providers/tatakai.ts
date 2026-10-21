import type { AnimeStreamingProvider, Playback, ProviderDiagnostic, StreamingAvailability } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { integrationsConfig } from '../config/integrations.js';
import type { TatakaiConfig } from '../config/integrations.js';

/**
 * Deliberately dormant: the independent TatakaiAPI repository is not public,
 * and neither an external API contract nor permission was verified.
 */
export class TatakaiStreamingProvider implements AnimeStreamingProvider {
  constructor(readonly config: TatakaiConfig = integrationsConfig.tatakai) {}

  async diagnostic(): Promise<ProviderDiagnostic> {
    return {
      id: 'tatakai', name: 'TatakaiAPI', enabled: this.config.enabled,
      state: this.config.enabled ? 'unauthorized' : 'unavailable',
      technicalAvailable: false, authorized: false, checkedAt: new Date().toISOString(),
      message: this.config.enabled
        ? 'Ativação solicitada, mas a API pública, seus contratos e as condições de uso ainda não foram validados. O adaptador permanece inativo.'
        : 'Integração desativada: API pública documentada e acesso permitido ainda não verificados.',
      capabilities: [],
    };
  }

  async episodes(_animeId: string): Promise<StreamingAvailability> {
    void _animeId;
    const diagnostic = await this.diagnostic();
    return { available: false, episodes: [], state: diagnostic.state, message: diagnostic.message, diagnostics: [diagnostic] };
  }

  async playback(_episodeId: string): Promise<Playback> {
    void _episodeId;
    throw new ApiError(503, 'TATAKAI_UNAVAILABLE', 'TatakaiAPI ainda não possui contrato HTTP público e acesso autorizado validados.');
  }
}
