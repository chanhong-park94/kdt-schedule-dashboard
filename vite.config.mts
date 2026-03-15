import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  envDir: '..',
  base: '/kdt-schedule-dashboard/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'chart': ['chart.js'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    include: ['../tests/**/*.test.ts'],
    environment: 'node'
  }
});
