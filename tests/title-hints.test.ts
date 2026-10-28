import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceParams } from '../src/frontend/services/content';
import { streamingService } from '../src/frontend/services/streaming';

const longOriginal = 'Tsuihou Sareta Cheat Fuyo Majutsushi wa Kimama na Second Life wo Ouka Suru.: Ore wa Buki dake ja Naku, Arayuru Mono ni "Kyouka Point" wo Fuyo Dekiru shi, Ore no Ishi de Itsudemo Kouka wo Kaijo Dekiru kedo, Nokotta Hitotachi Daijoubu?';
const english = 'The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life';

describe('source title contract', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('opens episode indexes with a valid short alias when the catalog original exceeds the source limit', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { available: true, episodes: [] } })));
    vi.stubGlobal('fetch', fetcher);
    await streamingService.episodes('207329', [english, longOriginal]);
    const path = fetcher.mock.calls[0] as unknown as [string];
    expect(new URL(path[0], 'http://localhost').searchParams.getAll('titles[]')).toEqual([english]);
  });
  it('omits unusable optional aliases without truncating or rejecting the anime ID', () => {
    expect(sourceParams({ titles: [longOriginal, english, ` ${english} `, 'line\nbreak', ''] }).getAll('title')).toEqual([english]);
    expect(sourceParams({ titles: [longOriginal] }).size).toBe(0);
  });
});
