/**
 * Inline SVG icon set.
 *
 * The reference layout loaded Lucide from a CDN. To keep the desktop bundle
 * dependency-free and offline-capable, the icons actually used are inlined here.
 *
 * @module variants/desktop/src/components/Icon
 */

import type { ReactNode } from 'react';

/** Icon identifiers available in this variant. */
export type IconName =
  | 'bot'
  | 'folder'
  | 'folder-git'
  | 'files'
  | 'file-code'
  | 'file-text'
  | 'file-check'
  | 'terminal'
  | 'square-terminal'
  | 'file-diff'
  | 'trash'
  | 'settings'
  | 'send'
  | 'sparkles'
  | 'user'
  | 'check'
  | 'x'
  | 'refresh'
  | 'plus'
  | 'cpu'
  | 'shield-alert'
  | 'loader'
  | 'git-commit'
  | 'user-check'
  | 'zap'
  | 'wifi'
  | 'play';

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  bot: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M12 8V4" />
      <circle cx="9" cy="14" r="1" />
      <circle cx="15" cy="14" r="1" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  'folder-git': (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="2" />
      <path d="M12 15v3" />
    </>
  ),
  files: (
    <>
      <path d="M15 3H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6z" />
      <path d="M15 3v4h4" />
    </>
  ),
  'file-code': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M10 13l-2 2 2 2" />
      <path d="M14 13l2 2-2 2" />
    </>
  ),
  'file-text': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  'file-check': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 15l2 2 4-4" />
    </>
  ),
  terminal: (
    <>
      <path d="M5 7l5 5-5 5" />
      <path d="M13 17h6" />
    </>
  ),
  'square-terminal': (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
    </>
  ),
  'file-diff': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h2M10 12v2" />
      <path d="M13 16h2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z" />
    </>
  ),
  send: <path d="M4 12l16-8-6 16-2-6z" />,
  sparkles: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  check: <path d="M5 13l4 4L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2 6" />
      <path d="M20 5v6h-6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  'shield-alert': (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.2" r="0.6" />
    </>
  ),
  loader: <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />,
  'git-commit': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6" />
    </>
  ),
  'user-check': (
    <>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 11-4.7" />
      <path d="M16 18l2 2 4-4" />
    </>
  ),
  zap: <path d="M13 2L4 14h6l-1 8 9-12h-6z" />,
  wifi: (
    <>
      <path d="M5 12a10 10 0 0 1 14 0" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  play: <path d="M7 4l12 8-12 8z" />,
};

/** Props accepted by {@link Icon}. */
export interface IconProps {
  readonly name: IconName;
  readonly className?: string;
}

/**
 * Render an inline SVG icon.
 */
export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
