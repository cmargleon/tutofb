import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('/@firebase/firestore/') || id.includes('/firebase/firestore/')) {
              return 'vendor-firebase-firestore';
            }

            if (id.includes('/@firebase/auth/') || id.includes('/firebase/auth/')) {
              return 'vendor-firebase-auth';
            }

            if (id.includes('/@firebase/storage/') || id.includes('/firebase/storage/')) {
              return 'vendor-firebase-storage';
            }

            if (id.includes('/@firebase/functions/') || id.includes('/firebase/functions/')) {
              return 'vendor-firebase-functions';
            }

            if (id.includes('/@firebase/app/') || id.includes('/firebase/app/')) {
              return 'vendor-firebase-core';
            }

            if (id.includes('/@firebase/') || id.includes('/firebase/')) {
              return 'vendor-firebase-shared';
            }

            if (id.includes('/react-router/') || id.includes('/react-router-dom/')) {
              return 'vendor-router';
            }

            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'vendor-react';
            }

            if (
              id.includes('/recharts/')
              || id.includes('/d3-')
              || id.includes('/internmap/')
              || id.includes('/react-resize-detector/')
            ) {
              return 'vendor-charts';
            }

            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }

            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
