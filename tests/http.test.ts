import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestData } from '../src/frontend/services/http';

const isNumber = (data: unknown): data is number => typeof data === 'number';

describe('HTTP data contract', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('coalesces concurrent requests and releases failed requests for retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: 4 })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await Promise.all([requestData('/same', isNumber), requestData('/same', isNumber)]);
    expect(result).toEqual([4, 4]);
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Indisponível' }), { status: 503 }));
    await expect(requestData('/retry', isNumber)).rejects.toThrow('Indisponível');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: 5 })));
    await expect(requestData('/retry', isNumber)).resolves.toBe(5);
  });

  it('rejects unexpected success payloads instead of inventing data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: 'invalid' }))));
    await expect(requestData('/unexpected', isNumber)).rejects.toThrow('dados inesperados');
  });

  it('cancels a slow request and presents a usable timeout message', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const expectation = expect(requestData('/slow', isNumber)).rejects.toThrow('demorou');
    await vi.advanceTimersByTimeAsync(25_000);
    await expectation;
  });

  it('reports a timeout when the response body stalls after headers arrive', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    })));
    const expectation = expect(requestData('/slow-body', isNumber)).rejects.toThrow('demorou');
    await vi.advanceTimersByTimeAsync(25_000);
    await expectation;
  });
});
