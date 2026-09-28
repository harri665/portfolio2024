import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme/tokens.css';
import './index.css';
import App from './App';
import ErrorBoundary from './Components/ErrorBoundary';
import reportWebVitals from './reportWebVitals';
import { detectSiteMode, getSiteHref, SITE_MODES } from './utils/siteMode';

// old art links: harrison-martin.com/#/projects/<id>. keep the hash, it can point at an asset
const legacyProject = window.location.hash.match(/^#\/projects\/([^/#?]+)/);
if (legacyProject) {
  const target = new URL(getSiteHref(SITE_MODES.ART));
  target.pathname = `/${legacyProject[1]}`;
  target.hash = window.location.hash;
  window.location.replace(target.toString());
}

document.documentElement.dataset.section = detectSiteMode();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary
      name="app"
      fallback={
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#08090c', color: '#fff', fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 16 }}>
          <div>
            <p style={{ marginBottom: 12 }}>Something went wrong loading this page.</p>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
              Reload
            </button>
          </div>
        </div>
      }
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
