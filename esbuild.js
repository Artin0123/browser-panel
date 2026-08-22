// Build script: bundles the extension host code + webview frontend with esbuild.
// Usage: node esbuild.js [--watch]
const esbuild = require('esbuild');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
  logLevel: 'info',
};

const webviewConfig = {
  entryPoints: ['src/webview/app.js'],
  bundle: true,
  outfile: 'dist/webview/app.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  target: ['chrome110', 'safari15'],
  logLevel: 'info',
};

function copyAssets() {
  fs.rmSync('dist', { recursive: true, force: true });
  copyStatic();
}

function copyStatic() {
  fs.mkdirSync('dist/webview', { recursive: true });
  // Static webview assets (app.js is bundled separately, skip the source)
  fs.cpSync('src/webview', 'dist/webview', {
    recursive: true,
    filter: (src) => !src.endsWith('app.js') && !src.endsWith('icons.js'),
  });
  fs.cpSync('resources', 'dist/resources', { recursive: true });
}

async function main() {
  copyAssets();
  if (watch) {
    const ctxExt = await esbuild.context(extensionConfig);
    const ctxWeb = await esbuild.context(webviewConfig);
    await Promise.all([ctxExt.watch(), ctxWeb.watch()]);
    // Also watch static assets (index.html/styles.css) that esbuild doesn't bundle.
    for (const dir of ['src/webview', 'resources']) {
      fs.watch(dir, { recursive: true }, () => copyStatic());
    }
    console.log('[watch] esbuild watching...');
  } else {
    await esbuild.build(extensionConfig);
    await esbuild.build(webviewConfig);
    console.log('build complete -> dist/');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
