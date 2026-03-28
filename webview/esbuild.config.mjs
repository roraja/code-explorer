// @ts-check
import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ['webview/src/main.ts'],
  bundle: true,
  outdir: 'webview/dist',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
  logLevel: 'info',
  loader: {
    '.css': 'css',
  },
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('[esbuild] Watching webview for changes...');
  } else {
    await esbuild.build(config);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
