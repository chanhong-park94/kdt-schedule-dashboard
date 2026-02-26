import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  envDir: '..',
  base: '/kdt-schedule-dashboard/',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  test: {
    include: ['../tests/**/*.test.ts'],
    environment: 'node'
  }
});
