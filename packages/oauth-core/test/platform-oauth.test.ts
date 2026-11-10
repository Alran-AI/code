import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  platformOidcLoginUrl,
  platformOidcRedeem,
} from '../src/platform-oauth.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('platformOidcLoginUrl', () => {
  it('sends the browser to the Platform with the exact registered callback', () => {
    const url = new URL(
      platformOidcLoginUrl({
        platformOrigin: 'https://platform.ottili.one',
        callback: 'http://127.0.0.1:18370/callback',
      }),
    );
    expect(url.origin).toBe('https://platform.ottili.one');
    expect(url.pathname).toBe('/v2/auth/oidc/login');
    expect(url.searchParams.get('return_to')).toBe('http://127.0.0.1:18370/callback');
  });
});

describe('platformOidcRedeem', () => {
  it('accepts the live envelope, which carries no base_url', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body ?? '{}')),
        });
        return Response.json({
          schema_version: 'ottili.envelope/v1',
          data: {
            session_id: 'sess_live',
            company_id: 'co_live',
            subject_id: 'usr_live',
            expires_at: '2026-11-24T14:16:15.254Z',
          },
        });
      }),
    );

    const session = await platformOidcRedeem({
      platformBaseUrl: 'https://platform.ottili.one/',
      code: 'hnd_live-code',
    });

    expect(calls).toEqual([
      {
        url: 'https://platform.ottili.one/v2/auth/sessions/handoff',
        body: { code: 'hnd_live-code' },
      },
    ]);
    expect(session).toEqual({
      sessionId: 'sess_live',
      companyId: 'co_live',
      subjectId: 'usr_live',
      baseUrl: 'https://platform.ottili.one',
      via: 'oidc',
    });
  });

  it('keeps an explicit base_url when the Platform sends one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            session_id: 'sess_live',
            company_id: 'co_live',
            subject_id: 'usr_live',
            base_url: 'https://platform.example',
          },
        }),
      ),
    );

    const session = await platformOidcRedeem({
      platformBaseUrl: 'https://platform.ottili.one',
      code: 'hnd_live-code',
    });
    expect(session.baseUrl).toBe('https://platform.example');
  });

  it('refuses an envelope without a session or company', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ schema_version: 'ottili.envelope/v1', data: {} })),
    );

    await expect(
      platformOidcRedeem({
        platformBaseUrl: 'https://platform.ottili.one',
        code: 'hnd_live-code',
      }),
    ).rejects.toThrow(/session_id or company_id/);
  });
});
