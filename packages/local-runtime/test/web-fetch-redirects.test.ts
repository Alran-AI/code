import { describe, expect, it } from 'vitest';

import { LocalWebFetchClient, isCloudMetadataHost } from '../src/web-fetch/local-web-fetch-client.js';

const text = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/plain' }, ...init });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

function client(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    expect(init?.redirect).toBe('manual');
    const route = routes[url];
    if (!route) throw new Error(`unexpected request to ${url}`);
    return route();
  }) as typeof fetch;
  return { fetcher: new LocalWebFetchClient({ fetchImpl }), seen };
}

describe('web_fetch redirects', () => {
  it('follows a redirect and reports where it ended', async () => {
    const { fetcher, seen } = client({
      'https://a.example/start': () => redirect('/next'),
      'https://a.example/next': () => text('hello'),
    });
    const result = await fetcher.fetch({ url: 'https://a.example/start' });
    expect(result.content).toBe('hello');
    expect(result.finalUrl).toBe('https://a.example/next');
    expect(seen).toEqual(['https://a.example/start', 'https://a.example/next']);
  });

  it('does not follow a redirect to the cloud metadata service', async () => {
    const { fetcher, seen } = client({
      'https://public.example/': () => redirect('http://169.254.169.254/latest/meta-data/iam/security-credentials/'),
    });
    const result = await fetcher.fetch({ url: 'https://public.example/' });
    expect(result.content ?? '').not.toContain('security-credentials');
    expect(result.retrievalOutcome).toBe('invalid_request');
    expect(seen).toEqual(['https://public.example/']);
  });

  it('does not fetch a metadata address that is asked for directly', async () => {
    const { fetcher, seen } = client({});
    const result = await fetcher.fetch({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(result.retrievalOutcome).toBe('invalid_request');
    expect(seen).toEqual([]);
  });

  it('still reaches localhost and the intranet, which is what the tool is for', async () => {
    const { fetcher } = client({ 'http://127.0.0.1:3000/health': () => text('ok'), 'http://10.0.0.5/status': () => text('up') });
    expect((await fetcher.fetch({ url: 'http://127.0.0.1:3000/health' })).content).toBe('ok');
    expect((await fetcher.fetch({ url: 'http://10.0.0.5/status' })).content).toBe('up');
  });

  it('stops a redirect loop and a redirect to another scheme', async () => {
    const loop = client({ 'https://loop.example/': () => redirect('https://loop.example/') });
    expect((await loop.fetcher.fetch({ url: 'https://loop.example/' })).content ?? '').toContain('too many redirects');
    expect(loop.seen.length).toBe(11);

    const scheme = client({ 'https://a.example/': () => redirect('file:///etc/passwd') });
    const result = await scheme.fetcher.fetch({ url: 'https://a.example/' });
    expect(result.retrievalOutcome).toBe('invalid_request');
  });

  it('knows the metadata addresses', () => {
    for (const host of ['http://169.254.169.254/', 'http://169.254.0.1/', 'http://[fd00:ec2::254]/', 'http://metadata.google.internal/', 'http://100.100.100.200/']) {
      expect(isCloudMetadataHost(new URL(host)), host).toBe(true);
    }
    for (const host of ['http://127.0.0.1/', 'https://example.com/', 'http://10.0.0.1/', 'http://169.253.1.1/']) {
      expect(isCloudMetadataHost(new URL(host)), host).toBe(false);
    }
  });
});
