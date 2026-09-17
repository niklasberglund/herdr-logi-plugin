import { unlinkPlugin, postBuildProcessing } from '@logitech/plugin-toolkit';
import { esmShimPlugin } from '@logitech/plugin-toolkit/esbuild';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'tsup';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const isWatchEnabled = process.argv.includes('--watch') || process.argv.includes('-w');

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm'],
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  clean: true,
  bundle: true,
  platform: 'node',
  target: 'es2022',
  noExternal: [/.*/],
  minify: isProduction,
  sourcemap: !isProduction,
  onSuccess: async () => {
    console.log('✅ TS build completed.');
    await postBuildProcessing(__dirname, isWatchEnabled);

    if (isWatchEnabled) {
      console.log('👀 Watching for file changes... Press Ctrl+C to stop.');
    }
  },
  watch: isWatchEnabled,
  shims: true,
  esbuildPlugins: [
    esmShimPlugin({ require: true })
  ]
});

if (isWatchEnabled) {
  // Handle graceful shutdown
  const cleanup = async () => {
    try {
      console.log('🛑 Stopping watch mode...');
      console.log('🔓 Unlinking plugin...');
      await unlinkPlugin(true);
    } catch (error) {
      console.warn('⚠️ Failed to unlink plugin:', (error as Error).message);
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
