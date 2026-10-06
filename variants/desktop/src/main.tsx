/**
 * Desktop variant entry point.
 *
 * @module variants/desktop/src/main
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/theme.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root was not found in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
