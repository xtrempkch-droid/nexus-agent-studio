/**
 * Tests for the preview renderer.
 *
 * The renderer produces markup that the preview iframe runs, so escaping and link
 * sanitising are the point — a Markdown file is untrusted input as far as this
 * module is concerned.
 *
 * @module variants/desktop/src/lib/preview.test
 */

import { describe, expect, it } from 'vitest';
import {
  PREVIEW_MESSAGE_SOURCE,
  buildPreviewDocument,
  escapeHtml,
  parseConsoleMessage,
  previewKindOf,
  renderMarkdown,
} from './preview.ts';

describe('previewKindOf', () => {
  it('maps the extensions it renders specially', () => {
    expect(previewKindOf('index.html')).toBe('html');
    expect(previewKindOf('README.md')).toBe('markdown');
    expect(previewKindOf('package.json')).toBe('json');
    expect(previewKindOf('style.css')).toBe('text');
  });

  it('is case-insensitive and tolerates paths and missing extensions', () => {
    expect(previewKindOf('docs/GUIA.MD')).toBe('markdown');
    expect(previewKindOf('Makefile')).toBe('text');
  });

  it('refuses binary formats instead of showing replacement characters', () => {
    for (const path of ['logo.png', 'doc.pdf', 'a.zip', 'f.woff2']) {
      expect(previewKindOf(path), path).toBe('none');
    }
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that change meaning', () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;',
    );
  });
});

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and emphasis', () => {
    const html = renderMarkdown('# Título\n\nTexto **forte** e *leve* e `código`.');

    expect(html).toContain('<h1>Título</h1>');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).toContain('<em>leve</em>');
    expect(html).toContain('<code>código</code>');
  });

  it('joins wrapped lines into one paragraph', () => {
    expect(renderMarkdown('uma linha\noutra linha')).toBe('<p>uma linha<br />outra linha</p>');
  });

  it('escapes HTML in the source instead of rendering it', () => {
    const html = renderMarkdown('<script>alert(1)</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the contents of a fenced code block', () => {
    const html = renderMarkdown('```html\n<div class="x">&</div>\n```');

    expect(html).toContain('<pre><code class="language-html">');
    expect(html).toContain('&lt;div class=&quot;x&quot;&gt;&amp;&lt;/div&gt;');
  });

  it('keeps emphasis characters inside a code span literal', () => {
    expect(renderMarkdown('`a ** b`')).toBe('<p><code>a ** b</code></p>');
  });

  it('renders both list kinds', () => {
    expect(renderMarkdown('- um\n- dois')).toBe('<ul><li>um</li><li>dois</li></ul>');
    expect(renderMarkdown('1. um\n2. dois')).toBe('<ol><li>um</li><li>dois</li></ol>');
  });

  it('renders blockquotes and rules', () => {
    expect(renderMarkdown('> citação')).toBe('<blockquote>citação</blockquote>');
    expect(renderMarkdown('---')).toBe('<hr />');
  });

  it('turns safe links into anchors that cannot reach back into the app', () => {
    const html = renderMarkdown('[doc](https://example.com/a)');

    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('refuses a dangerous link scheme but keeps the label', () => {
    // `javascript:` in a link is the classic way markup becomes script.
    const html = renderMarkdown('[clique](javascript:alert(1))');

    expect(html).toBe('<p>clique</p>');
  });

  it('leaves an unsupported construct as literal text rather than guessing', () => {
    expect(renderMarkdown('| a | b |')).toBe('<p>| a | b |</p>');
  });
});

describe('buildPreviewDocument', () => {
  it('wraps Markdown in a document with the console bridge', () => {
    const document = buildPreviewDocument('markdown', '# Oi');

    expect(document).toContain('<h1>Oi</h1>');
    expect(document).toContain(PREVIEW_MESSAGE_SOURCE);
    expect(document.startsWith('<!doctype html>')).toBe(true);
  });

  it('pretty-prints JSON and falls back to the raw text when it is invalid', () => {
    expect(buildPreviewDocument('json', '{"a":1}')).toContain('&quot;a&quot;: 1');
    expect(buildPreviewDocument('json', '{oops')).toContain('{oops');
  });

  it('injects the bridge into an HTML document before </body>', () => {
    const document = buildPreviewDocument('html', '<html><body><p>oi</p></body></html>');

    expect(document).toContain('<p>oi</p>');
    expect(document.indexOf(PREVIEW_MESSAGE_SOURCE)).toBeGreaterThan(document.indexOf('<p>oi</p>'));
    expect(document.indexOf(PREVIEW_MESSAGE_SOURCE)).toBeLessThan(document.indexOf('</body>'));
  });

  it('handles an HTML fragment with no body element', () => {
    const document = buildPreviewDocument('html', '<p>solto</p>');

    expect(document).toContain('<p>solto</p>');
    expect(document).toContain(PREVIEW_MESSAGE_SOURCE);
  });

  it('shows plain text verbatim, escaped', () => {
    expect(buildPreviewDocument('text', 'a < b')).toContain('a &lt; b');
  });
});

describe('parseConsoleMessage', () => {
  it('accepts a message from the bridge', () => {
    expect(
      parseConsoleMessage({ source: PREVIEW_MESSAGE_SOURCE, level: 'error', text: 'quebrou' }),
    ).toEqual({ level: 'error', text: 'quebrou' });
  });

  it('ignores anything that is not from the bridge', () => {
    expect(parseConsoleMessage({ source: 'other', level: 'log', text: 'x' })).toBeNull();
    expect(parseConsoleMessage({ level: 'log', text: 'x' })).toBeNull();
    expect(parseConsoleMessage('texto')).toBeNull();
    expect(parseConsoleMessage(null)).toBeNull();
  });

  it('falls back to log for an unknown level and caps the text', () => {
    const parsed = parseConsoleMessage({
      source: PREVIEW_MESSAGE_SOURCE,
      level: 'silly',
      text: 'x'.repeat(5000),
    });

    expect(parsed?.level).toBe('log');
    expect(parsed?.text.length).toBe(2000);
  });
});
