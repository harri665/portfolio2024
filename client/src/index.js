import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './Components/ErrorBoundary';
import reportWebVitals from './reportWebVitals';

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

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
