/**
 * Rendering a file for the preview panel.
 *
 * Two jobs, and both touch untrusted text: the user's file becomes HTML that the
 * preview iframe runs, and its `console` output becomes lines the panel displays.
 *
 * ## Why escaping is done by hand
 *
 * The preview is a sandboxed iframe (`allow-scripts`, no `allow-same-origin`), so
 * page script cannot reach this app's DOM or storage. That is the real boundary.
 * Escaping is still applied because "the sandbox will catch it" is not a reason to
 * emit broken markup: an unescaped `<` in a Markdown file silently eats the rest
 * of the document, which reads as a renderer bug.
 *
 * @module variants/desktop/src/lib/preview
 */

/** What the preview can show for a given file. */
export type PreviewKind = 'html' | 'markdown' | 'json' | 'text' | 'none';

/** Markers used by the console bridge inside the iframe. */
export const PREVIEW_MESSAGE_SOURCE = 'nexus-preview-console';

/** One line captured from the previewed page. */
export interface PreviewConsoleLine {
  readonly level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  readonly text: string;
}

/** Extension → kind. Anything else is shown as plain text, or not at all. */
const KIND_BY_EXTENSION: Readonly<Record<string, PreviewKind>> = {
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  txt: 'text',
  css: 'text',
  js: 'text',
  mjs: 'text',
  ts: 'text',
  tsx: 'text',
  jsx: 'text',
  py: 'text',
  rs: 'text',
  go: 'text',
  yml: 'text',
  yaml: 'text',
  toml: 'text',
  sh: 'text',
  sql: 'text',
};

/**
 * Which renderer applies to `path`.
 *
 * Binary formats (images, PDFs, archives) answer `none`: the core reads text, and
 * pretending otherwise would show a page of replacement characters.
 */
export function previewKindOf(path: string): PreviewKind {
  const dot = path.lastIndexOf('.');
  if (dot === -1) {
    return 'text';
  }
  const extension = path.slice(dot + 1).toLowerCase();
  const binary = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'ico',
    'pdf',
    'zip',
    'gz',
    'tar',
    'mp3',
    'mp4',
    'woff',
    'woff2',
    'ttf',
  ]);
  if (binary.has(extension)) {
    return 'none';
  }
  return KIND_BY_EXTENSION[extension] ?? 'text';
}

/** Escape the five characters that change meaning inside HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only these schemes become links; anything else keeps its text and loses the URL. */
function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  if (/^#/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Replace `[label](url)` with anchors, scanning so nested parentheses work.
 *
 * A regex cannot do this correctly: `[x](javascript:alert(1))` has a `)` inside
 * the URL, and a naive pattern stops early and leaves a stray `)` in the output.
 * Counting depth costs a few lines and gets the whole construct.
 */
function replaceLinks(text: string): string {
  let out = '';
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('[', index);
    if (open === -1) {
      out += text.slice(index);
      break;
    }

    const close = text.indexOf(']', open + 1);
    if (close === -1 || text[close + 1] !== '(') {
      out += text.slice(index, open + 1);
      index = open + 1;
      continue;
    }

    let depth = 1;
    let cursor = close + 2;
    while (cursor < text.length && depth > 0) {
      const character = text[cursor];
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      if (depth > 0) cursor += 1;
    }

    if (depth !== 0) {
      // Unbalanced: leave the rest as text rather than swallowing it.
      out += text.slice(index);
      break;
    }

    const label = text.slice(open + 1, close);
    const href = text.slice(close + 2, cursor);
    out += text.slice(index, open);

    const safe = safeHref(href);
    out +=
      safe === null
        ? label
        : `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`;

    index = cursor + 1;
  }

  return out;
}

/**
 * Inline Markdown: code spans, bold, italic, strikethrough and links.
 *
 * Code spans are extracted first so `**` inside them stays literal, then put back
 * at the end — the usual trick, and the reason a simple `replace` chain is enough
 * here.
 */
function renderInline(escaped: string): string {
  const codes: string[] = [];
  let text = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${String(codes.length - 1)}\u0000`;
  });

  text = replaceLinks(text);

  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codes[Number(index)] ?? '');
}

/**
 * Render Markdown to HTML.
 *
 * A deliberately small subset — headings, lists, quotes, fenced code, rules,
 * emphasis, code spans and links — because the alternative is a dependency, and
 * this project keeps the desktop bundle dependency-free so it builds offline. A
 * construct outside the subset degrades to literal text, which is honest.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    // Fenced code block: content is escaped, never parsed.
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence !== null) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // closing fence
      const className = language === '' ? '' : ` class="language-${escapeHtml(language)}"`;
      out.push(`<pre><code${className}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? '#').length;
      out.push(`<h${String(level)}>${renderInline(escapeHtml(heading[2] ?? ''))}</h${String(level)}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push('<hr />');
      index += 1;
      continue;
    }

    // Blockquote: consecutive `>` lines become one quote.
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        body.push(renderInline(escapeHtml((lines[index] ?? '').replace(/^\s*>\s?/, ''))));
        index += 1;
      }
      out.push(`<blockquote>${body.join('<br />')}</blockquote>`);
      continue;
    }

    // Lists: consecutive items of the same kind become one list.
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null && bullet === null;
      const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index] ?? '');
        if (match === null) break;
        items.push(`<li>${renderInline(escapeHtml(match[1] ?? ''))}</li>`);
        index += 1;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // Paragraph: until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        /^\s*$/.test(current) ||
        /^\s*```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        /^\s*>\s?/.test(current) ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current) ||
        /^\s*([-*_])\1{2,}\s*$/.test(current)
      ) {
        break;
      }
      paragraph.push(renderInline(escapeHtml(current.trim())));
      index += 1;
    }
    out.push(`<p>${paragraph.join('<br />')}</p>`);
  }

  return out.join('\n');
}

/**
 * The bridge that forwards the page's console to the panel.
 *
 * Runs inside the iframe. `console` methods are wrapped rather than replaced so a
 * page that inspects them still sees functions, and `onerror` plus
 * `unhandledrejection` are wired in so an exception is not silent.
 */
const CONSOLE_BRIDGE = `
(function () {
  var source = ${JSON.stringify(PREVIEW_MESSAGE_SOURCE)};
  function send(level, args) {
    var text = Array.prototype.map.call(args, function (value) {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.name + ': ' + value.message;
      try { return JSON.stringify(value); } catch (error) { return String(value); }
    }).join(' ');
    parent.postMessage({ source: source, level: level, text: text }, '*');
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      send(level, arguments);
      if (typeof original === 'function') original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (event) {
    send('error', [event.message + ' (linha ' + event.lineno + ')']);
  });
  window.addEventListener('unhandledrejection', function (event) {
    send('error', ['Promessa rejeitada: ' + String(event.reason)]);
  });
  parent.postMessage({ source: source, level: 'info', text: 'Pré-visualização carregada.' }, '*');
})();
`;

/** Shared look for every preview, so the panel matches the editor chrome. */
const PREVIEW_STYLE = `
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 16px 20px;
    font: 14px/1.6 ui-sans-serif, system-ui, sans-serif;
    color: #e2e8f0; background: #0a0f1a;
  }
  h1, h2, h3, h4 { color: #f8fafc; line-height: 1.25; margin: 1.2em 0 0.5em; }
  h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
  a { color: #818cf8; }
  code, pre { font-family: ui-monospace, monospace; font-size: 12.5px; }
  code { background: #131c2e; padding: 1px 4px; border-radius: 3px; }
  pre { background: #0d1526; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #334155; color: #94a3b8; }
  table { border-collapse: collapse; } td, th { border: 1px solid #1e293b; padding: 4px 8px; }
  hr { border: 0; border-top: 1px solid #1e293b; }
  img { max-width: 100%; }
`;

/**
 * Build the document the iframe renders.
 *
 * `html` files are wrapped as-is (that is the point of previewing HTML); every
 * other kind is rendered by this module, so the result is already safe markup.
 * The console bridge is appended in both cases.
 */
export function buildPreviewDocument(kind: PreviewKind, content: string): string {
  if (kind === 'html') {
    return content.includes('</body>')
      ? content.replace('</body>', `<script>${CONSOLE_BRIDGE}</script></body>`)
      : `${content}<script>${CONSOLE_BRIDGE}</script>`;
  }

  let body: string;
  if (kind === 'markdown') {
    body = renderMarkdown(content);
  } else if (kind === 'json') {
    // Pretty-print when it parses; otherwise show what the file really says.
    try {
      body = `<pre>${escapeHtml(JSON.stringify(JSON.parse(content), null, 2))}</pre>`;
    } catch {
      body = `<pre>${escapeHtml(content)}</pre>`;
    }
  } else {
    body = `<pre>${escapeHtml(content)}</pre>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8" /><style>${PREVIEW_STYLE}</style></head><body>${body}<script>${CONSOLE_BRIDGE}</script></body></html>`;
}

/**
 * Read a `message` event as a console line, or `null` when it is not one of ours.
 *
 * The `source` marker is what keeps unrelated messages (an extension, another
 * frame) out of the panel.
 */
export function parseConsoleMessage(data: unknown): PreviewConsoleLine | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const candidate = data as { source?: unknown; level?: unknown; text?: unknown };
  if (candidate.source !== PREVIEW_MESSAGE_SOURCE || typeof candidate.text !== 'string') {
    return null;
  }

  const levels = new Set(['log', 'info', 'warn', 'error', 'debug']);
  const level = typeof candidate.level === 'string' && levels.has(candidate.level)
    ? (candidate.level as PreviewConsoleLine['level'])
    : 'log';

  return { level, text: candidate.text.slice(0, 2000) };
}
