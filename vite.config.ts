import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-oxc';
import path from 'path';

export default defineConfig({
  base: '/Browser-Game/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
  },
});
