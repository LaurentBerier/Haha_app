#!/usr/bin/env node
/* global process, console */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const outDir = path.join(projectRoot, 'dist-web');
const indexHtmlPath = path.join(outDir, 'index.html');
const vercelConfigPath = path.join(outDir, 'vercel.web.json');

function findBackgroundAsset() {
  const candidateDirs = [
    path.join(outDir, 'assets', 'assets', 'branding'),
    path.join(outDir, 'assets', 'branding')
  ];

  for (const dir of candidateDirs) {
    if (!existsSync(dir)) {
      continue;
    }

    const backgroundAssetName = readdirSync(dir).find(
      (entry) => entry.startsWith('Clean_BG.') && entry.endsWith('.jpg')
    );

    if (!backgroundAssetName) {
      continue;
    }

    const relativeDir = dir
      .replace(outDir, '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const urlPath = `/${relativeDir}/${backgroundAssetName}`;
    return { urlPath };
  }

  return null;
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function patchIndexHtml() {
  const html = readFileSync(indexHtmlPath, 'utf8');

  // Older Expo exports render defer scripts; newer variants may already be module scripts.
  const scriptPatched = html.replace(
    /<script src="(\/_expo\/static\/js\/web\/[^"]+\.js)" defer><\/script>/,
    '<script type="module" src="$1"></script>'
  );

  const scriptPatchedOrOriginal = scriptPatched === html ? html : scriptPatched;

  const backgroundAsset = findBackgroundAsset();
  if (!backgroundAsset) {
    console.warn('[exportWeb] Clean_BG asset not found in exported assets, skipping body background patch.');
    writeFileSync(indexHtmlPath, scriptPatchedOrOriginal, 'utf8');
    return;
  }

  const backgroundUrl = backgroundAsset.urlPath;
  const backgroundStyle = `<style id="haha-web-bg">html{background-color:#090D16;}body{background-image:url('${backgroundUrl}');background-size:auto 100vh;background-position:center center;background-repeat:no-repeat;background-attachment:fixed;background-color:#090D16;}@media (min-aspect-ratio:16/10){body{background-size:auto 118vh;}}@media (min-aspect-ratio:16/9){body{background-size:auto 138vh;}}@media (min-aspect-ratio:21/9){body{background-size:auto 165vh;}}#root{background-color:transparent!important;}#root div[style*="background-color: rgb(242, 242, 242)"]{background-color:transparent!important;}</style>`;
  const withBackground = scriptPatchedOrOriginal.replace('</head>', `${backgroundStyle}</head>`);

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
