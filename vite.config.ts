import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    allowedHosts: ['primal-fracture.onrender.com'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'].some(pkg => id.includes(pkg))) {
            return 'vendor';
          }
        },
      },
    },
  },
});