// @ts-check
import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'tree-sitter', 'tree-sitter-cpp', 'tree-sitter-typescript'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
  logLevel: 'info',
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('[esbuild] Watching extension for changes...');
  } else {
    await esbuild.build(config);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
