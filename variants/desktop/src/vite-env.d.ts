/// <reference types="vite/client" />

/**
 * Ambient module declarations for the desktop (Vite) variant.
 *
 * `vite/client` supplies the declarations for `*.css` side-effect imports (it
 * contains `declare module '*.css' {}`), for static asset modules such as
 * `.png` and `.svg`, and for `import.meta.env`. Referencing it here is the
 * documented opt-in. Without it, TypeScript reports "Cannot find module or type
 * declarations for side-effect import" from `main.tsx` for
 * `import './styles/theme.css'`.
 *
 * `.d.ts` files are excluded from ESLint in eslint.config.js, which is what
 * makes the triple-slash reference acceptable here rather than a plain import.
 *
 * Verified against vite@8.3.2: its package.json exposes
 * `exports["./client"] = { types: "./client.d.ts" }`.
 */
