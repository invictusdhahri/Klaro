import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // @klaro/shared resolves to .ts sources; must be bundled or Node fails at runtime (ERR_UNKNOWN_FILE_EXTENSION).
  noExternal: ['@klaro/shared'],
});
