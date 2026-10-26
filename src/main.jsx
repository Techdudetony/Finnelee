// Entry point: find <div id="root"> in index.html and render the React app into it.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode runs extra dev-only checks (e.g. double-invokes effects) to surface bugs early.
  <React.StrictMode>
    {/* AuthProvider wraps everything so any component can call useAuth(). */}
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
