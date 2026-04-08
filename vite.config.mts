import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  envDir: '..',
  base: '/kdt-schedule-dashboard/',
  esbuild: {
    // 프로덕션 빌드에서 console.log/warn 제거 (보안: PII 노출 방지)
    drop: process.env.NODE_ENV === 'production' ? ['console'] : [],
  },
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
