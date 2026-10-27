'use strict';

// The installed Nebula resolver uses AniList identifiers directly. Its public
// website exposes a separate paginated index; a catalog count alone never
// establishes that a video exists for any of these entries.
const ORIGIN = 'https://justanime.to';
const API = 'https://core.justanime.to';
const EMPTY = () => ({ provider: null, episodeCount: 0, episodes: [] });

function invalid(message = 'Invalid source episode index') {
  return Object.assign(new Error(message), { status: 502 });
}

function integer(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function normalizeIndex(value, providers) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.episodes) || value.episodes.length > 5000) throw invalid();
  if (!value.episodes.length) return EMPTY();
  if (typeof value.provider !== 'string' || !providers.has(value.provider)) throw invalid();
  const episodes = new Map();
  for (const row of value.episodes) {
    if (!row || typeof row !== 'object' || typeof row.number !== 'number' || !Number.isFinite(row.number) || row.number <= 0 || row.number > 100000) throw invalid();
    const title = typeof row.title === 'string' && row.title.trim() && row.title.length <= 500 ? row.title.trim() : undefined;
    episodes.set(row.number, { number: row.number, ...(title ? { title } : {}) });
  }
  return { provider: value.provider, episodeCount: episodes.size, episodes: [...episodes.values()].sort((a, b) => a.number - b.number) };
}

function createEpisodeIndexResolver({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let active = 0;

  async function page(anilistId, pageNumber, expected, budget, signal) {
    // Neither namespace, titles nor URLs from a request can change this host.
    const url = `${API}/api/anime/${anilistId}/episodes?page=${pageNumber}`;
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': 'HPmovies/2.0 local episode index' },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    });
    if (response.status === 404 && pageNumber === 1) { await response.body?.cancel(); return null; }
    if (!response.ok || !/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); throw invalid(`Episode index returned HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length') || 0) > 2000000) { await response.body?.cancel(); throw invalid(); }
    const reader = response.body?.getReader();
    if (!reader) throw invalid();
    const chunks = []; let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength; budget.bytes += chunk.value.byteLength;
      if (size > 2000000 || budget.bytes > 10000000) { await reader.cancel(); throw invalid('Source episode index is too large'); }
      chunks.push(chunk.value);
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
    if (!data || data.id !== anilistId || data.currentPage !== pageNumber || !integer(data.totalPages, 50) || !integer(data.totalResults, 5000) || !Array.isArray(data.episodes) || data.episodes.length > 100 || data.totalPages < 1 || data.totalResults < data.episodes.length) throw invalid();
    if (expected && (data.totalPages !== expected.totalPages || data.totalResults !== expected.totalResults)) throw invalid('Source episode pagination changed');
    for (const row of data.episodes) if (!row || typeof row !== 'object' || typeof row.number !== 'number' || !Number.isFinite(row.number) || row.number <= 0 || row.number > 100000) throw invalid();
    return data;
  }

  async function nebula(anilistId) {
    const budget = { bytes: 0 };
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 45000);
    try {
      const first = await page(anilistId, 1, null, budget, controller.signal);
      if (!first) return EMPTY();
      const rows = [...first.episodes]; let nextPage = 2;
      const worker = async () => {
        while (nextPage <= first.totalPages && !controller.signal.aborted) {
          const data = await page(anilistId, nextPage++, first, budget, controller.signal);
          rows.push(...data.episodes);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, first.totalPages - 1) }, worker));
      if (controller.signal.aborted) throw invalid('Episode index timed out');
      return normalizeIndex({ provider: 'nebula', episodes: rows }, new Set(['nebula']));
    } finally { clearTimeout(deadline); controller.abort(); }
  }

  async function extensionIndex(bundle, anilistId, titles, providers) {
    if (typeof bundle.getWebsiteEpisodeIndex !== 'function') return EMPTY();
    let timer;
    try {
      return normalizeIndex(await Promise.race([
        bundle.getWebsiteEpisodeIndex({ anilistId, titles }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Episode index timed out'), { status: 504 })), 25000); }),
      ]), providers);
    } finally { clearTimeout(timer); }
  }

  return async ({ bundle, entry, namespace, anilistId, titles }) => {
    const inventory = typeof bundle.listProviders === 'function' ? bundle.listProviders() : [];
    const providers = new Set((Array.isArray(inventory) ? inventory : []).filter(row => row?.kind === 'stream').map(row => row.name));
    const useNebula = providers.has('nebula') && entry.runtime?.providers?.includes('nebula');
    const key = JSON.stringify([namespace, anilistId, useNebula ? 'nebula' : titles]);
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (active >= 4) throw Object.assign(new Error('Episode index is busy'), { status: 503 });
    const task = (async () => {
      active++;
      try {
        const value = useNebula ? await nebula(anilistId) : await extensionIndex(bundle, anilistId, titles, providers);
        cache.set(key, { value, expiresAt: now() + (value.episodes.length ? 120000 : 15000) });
        while (cache.size > 64) cache.delete(cache.keys().next().value);
        return value;
      } finally { active--; }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}

module.exports = { createEpisodeIndexResolver };
