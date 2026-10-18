// Bundles the Electron main process and preload script into dist-electron/.
import { build } from 'esbuild'

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Minified like the Vite renderer bundles; the source maps stay out of the installer
  minify: true,
  sourcemap: true,
  logLevel: 'info',
  // koffi is a native module and must be loaded from node_modules at runtime
  external: ['electron', 'koffi'],
}

await Promise.all([
  build({ ...shared, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' }),
  build({ ...shared, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' }),
])
