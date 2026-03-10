#!/usr/bin/env node
/* global process, console */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const outDir = path.join(projectRoot, 'dist-web');
const indexHtmlPath = path.join(outDir, 'index.html');
const vercelConfigPath = path.join(outDir, 'vercel.web.json');
const brandingDir = path.join(outDir, 'assets', 'assets', 'branding');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function patchIndexHtml() {
  const html = readFileSync(indexHtmlPath, 'utf8');
  const scriptPatched = html.replace(
    /<script src="(\/_expo\/static\/js\/web\/[^"]+\.js)" defer><\/script>/,
    '<script type="module" src="$1"></script>'
  );

  if (scriptPatched === html) {
    throw new Error('Could not patch dist-web/index.html script tag.');
  }

  const backgroundAssetName = readdirSync(brandingDir).find(
    (entry) => entry.startsWith('Clean_BG.') && entry.endsWith('.jpg')
  );

  if (!backgroundAssetName) {
    throw new Error('Could not find Clean_BG asset in dist-web export.');
  }

  const backgroundUrl = `/assets/assets/branding/${backgroundAssetName}`;
  const backgroundStyle = `<style id="haha-web-bg">html{background-color:#090D16;}body{background-image:url('${backgroundUrl}');background-size:auto 100vh;background-position:center center;background-repeat:no-repeat;background-attachment:fixed;background-color:#090D16;}@media (min-aspect-ratio:16/10){body{background-size:auto 118vh;}}@media (min-aspect-ratio:16/9){body{background-size:auto 138vh;}}@media (min-aspect-ratio:21/9){body{background-size:auto 165vh;}}#root{background-color:transparent!important;}#root div[style*="background-color: rgb(242, 242, 242)"]{background-color:transparent!important;}</style>`;
  const withBackground = scriptPatched.replace('</head>', `${backgroundStyle}</head>`);

  writeFileSync(indexHtmlPath, withBackground, 'utf8');
}

function writeVercelConfig() {
  const config = {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    outputDirectory: '.',
    routes: [{ handle: 'filesystem' }, { src: '/.*', dest: '/index.html' }]
  };

  writeFileSync(vercelConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function main() {
  mkdirSync(outDir, { recursive: true });
  run('npx expo export --platform web --output-dir dist-web');
  patchIndexHtml();
  writeVercelConfig();
  console.log('Web export ready in dist-web/ (module script + Vercel SPA config).');
}

main();
