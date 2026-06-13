import { defineConfig } from 'vite';
import { builtinModules } from 'module';

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'grandi',
        /^@grandi\//,
        'tar',
        'onnxruntime-node',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
      },
    },
    minify: false,
    sourcemap: false,
  },
});
