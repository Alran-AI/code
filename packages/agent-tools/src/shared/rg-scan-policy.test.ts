import { describe, expect, it } from 'vitest';

import { filterGlobPaths, globToPathMatcher } from './rg-scan-policy.js';

describe('globToPathMatcher', () => {
  it('matches nested paths for a basename-only pattern', () => {
    const matches = globToPathMatcher('*.json');

    expect(matches('package.json')).toBe(true);
    expect(matches('packages/agent-tools/package.json')).toBe(true);
    expect(matches('packages/agent-tools/src/index.ts')).toBe(false);
  });

  it('matches nested and dot paths when dot matching is enabled', () => {
    const matches = globToPathMatcher('**/*.ts');

    expect(matches('src/index.ts')).toBe(true);
    expect(matches('src/nested/index.ts')).toBe(true);
    expect(matches('.config/index.ts')).toBe(true);
    expect(matches('src/index.tsx')).toBe(false);
  });

  it('preserves brace expansion behavior', () => {
    expect(filterGlobPaths(
      ['src/index.ts', 'src/view.tsx', 'src/style.css'],
      '**/*.{ts,tsx}',
    )).toEqual(['src/index.ts', 'src/view.tsx']);
  });

  it('rejects malformed patterns before matching', () => {
    expect(() => globToPathMatcher('src/[broken')).toThrow('invalid glob pattern');
    expect(() => globToPathMatcher('src/{a,b')).toThrow('invalid glob pattern');
  });

  it('normalizes Windows separators in candidate paths', () => {
    expect(filterGlobPaths(
      ['packages\\agent-tools\\src\\index.ts', 'packages\\agent-tools\\README.md'],
      '**/*.ts',
    )).toEqual(['packages\\agent-tools\\src\\index.ts']);
  });
});
