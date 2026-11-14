import { describe, expect, it } from 'vitest';

import { isSupportedBrowserUrl, LOCAL_BROWSER_URLS_ENV } from '../src/browser-actions.js';

describe('Browser navigation URL policy', () => {
  it('opens the web and about pages', () => {
    for (const url of ['https://example.com', 'HTTP://example.com/a?b', ' about:blank ']) {
      expect(isSupportedBrowserUrl(url, {})).toBe(true);
    }
  });

  it('does not let the model read local files or run script URLs', () => {
    for (const url of [
      'file:///home/me/.ssh/id_rsa',
      'FILE:///etc/passwd',
      ' file://localhost/etc/passwd',
      'data:text/html,<script>1</script>',
      'javascript:alert(1)',
      'chrome://settings',
      'view-source:https://example.com',
      '/etc/passwd',
    ]) {
      expect(isSupportedBrowserUrl(url, {})).toBe(false);
    }
  });

  it('opens local pages only when the user opted in', () => {
    const env = { [LOCAL_BROWSER_URLS_ENV]: '1' };
    expect(isSupportedBrowserUrl('file:///work/preview.html', env)).toBe(true);
    expect(isSupportedBrowserUrl('data:text/html,hi', env)).toBe(true);
    expect(isSupportedBrowserUrl('javascript:alert(1)', env)).toBe(false);
    expect(isSupportedBrowserUrl('file:///work/preview.html', { [LOCAL_BROWSER_URLS_ENV]: 'yes' })).toBe(false);
  });
});
