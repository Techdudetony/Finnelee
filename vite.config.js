// Import Vite's configuration helper.
import { defineConfig } from 'vite';

// Import the standard React plugin.
import react from '@vitejs/plugin-react';

// Export the configuration used by Vite.
export default defineConfig({
  plugins: [react()],
});
