// Entry point: find <div id="root"> in index.html and render the React app into it.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext';
import { startMotion } from './utils/motion';
import { startSurfaces } from './utils/surfaces';
// Self-hosted variable fonts: bundled with the app, so no requests to a font CDN.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

// Motion level from the device, set before the first paint (App.jsx applies the
// signed-in person's own choice from Settings).
startMotion();
// Card tilt and glow (Full motion, mouse/pen only). Lives for the whole session.
startSurfaces();

ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode runs extra dev-only checks (e.g. double-invokes effects) to surface bugs early.
  <React.StrictMode>
    {/* AuthProvider wraps everything so any component can call useAuth(). */}
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
