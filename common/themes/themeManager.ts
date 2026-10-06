/**
 * Reactive theme manager.
 *
 * Holds the active {@link ThemeObject} and broadcasts changes to subscribers
 * (the editor, the terminal, the syntax highlighter). Tokens are plain
 * `string -> string` maps so they can be emitted directly as CSS custom
 * properties. Two built-in skins mirror the desktop shell's palette.
 *
 * @module common/themes/themeManager
 */

/** UI or syntax token map. */
export type ThemeTokens = Readonly<Record<string, string>>;

/**
 * A complete theme: UI chrome tokens plus syntax highlighting tokens.
 */
export interface ThemeObject {
  readonly id: string;
  readonly name: string;
  readonly appearance: 'dark' | 'light';
  /** Chrome tokens: backgrounds, borders, accents. */
  readonly ui: ThemeTokens;
  /** Syntax tokens: keywords, strings, comments, ... */
  readonly syntax: ThemeTokens;
}

/** Observer invoked with the new theme after every change. */
export type ThemeListener = (theme: ThemeObject) => void;

/**
 * Built-in dark skin, derived from the `layout/` reference in this repository.
 */
export const DARK_THEME: ThemeObject = Object.freeze({
  id: 'nexus-dark',
  name: 'Nexus Dark',
  appearance: 'dark',
  ui: Object.freeze({
    'bg': '#0b0f19',
    'sidebar': '#070a12',
    'card': '#131b2e',
    'editor': '#0d1322',
    'border': '#1d283a',
    'accent': '#6366f1',
    'accent-hover': '#4f46e5',
    'green': '#10b981',
    'yellow': '#f59e0b',
    'red': '#ef4444',
    'foreground': '#e2e8f0',
    'muted': '#94a3b8',
  }),
  syntax: Object.freeze({
    keyword: '#c084fc',
    string: '#86efac',
    number: '#fbbf24',
    comment: '#64748b',
    function: '#60a5fa',
    type: '#5eead4',
    variable: '#e2e8f0',
  }),
});

/**
 * Built-in light skin.
 */
export const LIGHT_THEME: ThemeObject = Object.freeze({
  id: 'nexus-light',
  name: 'Nexus Light',
  appearance: 'light',
  ui: Object.freeze({
    'bg': '#f8fafc',
    'sidebar': '#f1f5f9',
    'card': '#ffffff',
    'editor': '#ffffff',
    'border': '#e2e8f0',
    'accent': '#4f46e5',
    'accent-hover': '#4338ca',
    'green': '#059669',
    'yellow': '#d97706',
    'red': '#dc2626',
    'foreground': '#0f172a',
    'muted': '#64748b',
  }),
  syntax: Object.freeze({
    keyword: '#7c3aed',
    string: '#047857',
    number: '#b45309',
    comment: '#94a3b8',
    function: '#1d4ed8',
    type: '#0f766e',
    variable: '#0f172a',
  }),
});

/** All built-in themes, keyed by id. */
export const BUILT_IN_THEMES: Readonly<Record<string, ThemeObject>> = Object.freeze({
  [DARK_THEME.id]: DARK_THEME,
  [LIGHT_THEME.id]: LIGHT_THEME,
});

/**
 * Observable, single-active-theme store with pub/sub notification.
 */
export class ThemeManager {
  private current: ThemeObject;
  private readonly listeners = new Set<ThemeListener>();

  /** @param initial - Theme to activate on construction. Defaults to {@link DARK_THEME}. */
  public constructor(initial: ThemeObject = DARK_THEME) {
    this.current = initial;
  }

  /**
   * Replace the active theme. Always emits, even when the id is unchanged, so
   * listeners can re-read freshly supplied token overrides.
   */
  public loadTheme(theme: ThemeObject): void {
    this.current = theme;
    this.emit();
  }

  /** Activate a built-in theme by id. */
  public loadBuiltIn(id: string): ThemeObject {
    const theme = BUILT_IN_THEMES[id];
    if (theme === undefined) {
      throw new Error(`Unknown built-in theme: "${id}".`);
    }
    this.loadTheme(theme);
    return theme;
  }

  /** The currently active theme. */
  public getTheme(): ThemeObject {
    return this.current;
  }

  /**
   * Override a single UI token on the active theme and notify listeners.
   */
  public setUiToken(name: string, value: string): void {
    this.current = Object.freeze({
      ...this.current,
      ui: Object.freeze({ ...this.current.ui, [name]: value }),
    });
    this.emit();
  }

  /**
   * Override a single syntax token on the active theme and notify listeners.
   */
  public setSyntaxToken(name: string, value: string): void {
    this.current = Object.freeze({
      ...this.current,
      syntax: Object.freeze({ ...this.current.syntax, [name]: value }),
    });
    this.emit();
  }

  /**
   * Flatten the active theme into CSS custom properties (`--ui-bg`, `--syntax-keyword`, ...).
   */
  public toCssVariables(): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.current.ui)) {
      vars[`--ui-${key}`] = value;
    }
    for (const [key, value] of Object.entries(this.current.syntax)) {
      vars[`--syntax-${key}`] = value;
    }
    return vars;
  }

  /**
   * Subscribe to theme changes.
   *
   * @returns An unsubscribe function.
   */
  public subscribe(listener: ThemeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }
}
