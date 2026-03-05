#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const outDir = path.join(projectRoot, 'dist-web');
const indexHtmlPath = path.join(outDir, 'index.html');
const vercelConfigPath = path.join(outDir, 'vercel.web.json');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function patchIndexHtml() {
  const html = readFileSync(indexHtmlPath, 'utf8');
  const patched = html.replace(
    /<script src="(\/_expo\/static\/js\/web\/[^"]+\.js)" defer><\/script>/,
    '<script type="module" src="$1"></script>'
  );

  if (patched === html) {
    throw new Error('Could not patch dist-web/index.html script tag.');
  }

  writeFileSync(indexHtmlPath, patched, 'utf8');
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
