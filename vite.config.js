// Vite config: the React plugin enables JSX + Fast Refresh (instant updates while you edit).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
