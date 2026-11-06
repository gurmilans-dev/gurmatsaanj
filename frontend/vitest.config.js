import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    setupFiles: process.env.TEST_RECORDING === '1' ? ['./test/helpers/recordingEnabled.js'] : [],
    include: ['test/**/*.test.js'],
    clearMocks: true,
    restoreMocks: true,
  },
});
