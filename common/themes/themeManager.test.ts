import { describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_THEMES,
  DARK_THEME,
  LIGHT_THEME,
  ThemeManager,
  type ThemeObject,
} from './themeManager.ts';

describe('built-in themes', () => {
  it('exposes dark and light skins', () => {
    expect(BUILT_IN_THEMES[DARK_THEME.id]).toBe(DARK_THEME);
    expect(BUILT_IN_THEMES[LIGHT_THEME.id]).toBe(LIGHT_THEME);
    expect(DARK_THEME.appearance).toBe('dark');
    expect(LIGHT_THEME.appearance).toBe('light');
  });

  it('defines the chrome tokens used by the desktop shell', () => {
    for (const token of ['bg', 'sidebar', 'card', 'editor', 'border', 'accent']) {
      expect(DARK_THEME.ui[token]).toBeTypeOf('string');
    }
  });
});

describe('ThemeManager', () => {
  it('defaults to the dark theme', () => {
    expect(new ThemeManager().getTheme()).toBe(DARK_THEME);
  });

  it('loads a built-in theme and notifies subscribers', () => {
    const manager = new ThemeManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.loadBuiltIn(LIGHT_THEME.id);

    expect(manager.getTheme()).toBe(LIGHT_THEME);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(LIGHT_THEME);
  });

  it('throws for an unknown built-in id', () => {
    expect(() => new ThemeManager().loadBuiltIn('does-not-exist')).toThrow(/Unknown built-in theme/u);
  });

  it('stops notifying after unsubscribe', () => {
    const manager = new ThemeManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    unsubscribe();

    manager.loadTheme(LIGHT_THEME);

    expect(listener).not.toHaveBeenCalled();
  });

  it('overrides a UI token without mutating the original theme', () => {
    const manager = new ThemeManager();
    manager.setUiToken('accent', '#ff0000');

    expect(manager.getTheme().ui['accent']).toBe('#ff0000');
    expect(DARK_THEME.ui['accent']).toBe('#6366f1');
  });

  it('overrides a syntax token', () => {
    const manager = new ThemeManager();
    manager.setSyntaxToken('keyword', '#123456');

    expect(manager.getTheme().syntax['keyword']).toBe('#123456');
  });

  it('emits on token overrides so the UI re-renders', () => {
    const manager = new ThemeManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.setUiToken('bg', '#000000');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('flattens tokens into CSS custom properties', () => {
    const manager = new ThemeManager();
    const vars = manager.toCssVariables();

    expect(vars['--ui-bg']).toBe(DARK_THEME.ui['bg']);
    expect(vars['--ui-accent']).toBe(DARK_THEME.ui['accent']);
    expect(vars['--syntax-keyword']).toBe(DARK_THEME.syntax['keyword']);
  });

  it('accepts a fully custom theme object', () => {
    const custom: ThemeObject = {
      id: 'custom',
      name: 'Custom',
      appearance: 'dark',
      ui: { bg: '#111111' },
      syntax: { keyword: '#222222' },
    };

    const manager = new ThemeManager(custom);

    expect(manager.getTheme().id).toBe('custom');
    expect(manager.toCssVariables()['--ui-bg']).toBe('#111111');
  });
});
