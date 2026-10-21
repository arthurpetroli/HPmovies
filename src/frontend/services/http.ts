const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '');
export const API_BASE_URL = configuredBase
  ? configuredBase.endsWith('/api') ? configuredBase : `${configuredBase}/api`
  : '/api';

const pending = new Map<string, Promise<unknown>>();

export async function requestData<T>(path: string, validate: (data: unknown) => data is T): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const existing = pending.get(url);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const payload: unknown = await response.json().catch((error: unknown) => {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      const envelope = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
      if (!response.ok) {
        const upstreamMessage = typeof envelope?.message === 'string' ? envelope.message
          : typeof envelope?.error === 'string' ? envelope.error : null;
        throw new Error(upstreamMessage || `Não foi possível carregar o conteúdo (${response.status}). Tente novamente.`);
      }
      if (!envelope || !validate(envelope.data)) {
        throw new Error('O serviço retornou dados inesperados. Tente novamente em instantes.');
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('O serviço demorou para responder. Tente novamente.');
      }
      if (error instanceof TypeError) {
        throw new Error('Não foi possível conectar ao catálogo. Confira sua conexão e tente novamente.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  pending.set(url, request);
  try {
    return await request;
  } finally {
    pending.delete(url);
  }
}
