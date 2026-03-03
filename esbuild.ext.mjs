import * as esbuild from 'esbuild'

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['ext/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  treeShaking: true,
})

if (watch) {
  await ctx.watch()
  console.log('[esbuild] watching extension host…')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('[esbuild] extension host built → dist/extension.cjs')
}
