#!/usr/bin/env node
/**
 * Runs Lighthouse against a local web build and compares against
 * `perf-baseline.json`. Exits with code 1 if any metric regresses beyond its
 * tolerance.
 *
 * Usage:
 *   node scripts/perfBaseline.mjs                  # check
 *   node scripts/perfBaseline.mjs --update         # rewrite baseline from this run
 *   PERF_TARGET_URL=http://localhost:8082 node scripts/perfBaseline.mjs
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const baselinePath = resolve(repoRoot, 'perf-baseline.json');

const TARGET_URL = process.env.PERF_TARGET_URL?.trim() || 'http://localhost:8082';
const SHOULD_UPDATE = process.argv.includes('--update');

function run(cmd, args, opts = {}) {
  return new Promise((resolveProc, rejectProc) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolveProc(stdout);
      else rejectProc(new Error(`${cmd} exited with code ${code}`));
    });
    child.on('error', rejectProc);
  });
}

async function loadBaseline() {
  const raw = await readFile(baselinePath, 'utf8');
  return JSON.parse(raw);
}

async function runLighthouse(url) {
  console.log(`[perfBaseline] Running Lighthouse against ${url}…`);
  const args = [
    'lighthouse',
    url,
    '--quiet',
    '--chrome-flags=--headless=new --no-sandbox',
    '--only-categories=performance',
    '--output=json',
    '--output-path=stdout',
    '--throttling-method=simulate',
    '--form-factor=mobile'
  ];
  const stdout = await run('npx', args);
  const result = JSON.parse(stdout);
  const audits = result.audits ?? {};
  const performanceCategory = result.categories?.performance;
  return {
    performanceScore: performanceCategory?.score ?? 0,
    lcpMs: audits['largest-contentful-paint']?.numericValue ?? 0,
    tbtMs: audits['total-blocking-time']?.numericValue ?? 0,
    clsScore: audits['cumulative-layout-shift']?.numericValue ?? 0,
    fcpMs: audits['first-contentful-paint']?.numericValue ?? 0,
    tti: audits['interactive']?.numericValue ?? 0,
    speedIndex: audits['speed-index']?.numericValue ?? 0
  };
}

const HIGHER_IS_BETTER = new Set(['performanceScore']);

function compare(observed, baseline, tolerance) {
  const failures = [];
  for (const [metric, baselineValue] of Object.entries(baseline)) {
    const observedValue = observed[metric];
    if (observedValue === undefined || observedValue === null) continue;
    const tol = tolerance[metric] ?? 0.1;
    if (HIGHER_IS_BETTER.has(metric)) {
      // Lower observed = regression. tolerance is absolute for fractional scores.
      const limit = baselineValue - tol;
      if (observedValue < limit) {
        failures.push({ metric, observed: observedValue, baseline: baselineValue, limit });
      }
    } else {
      // Higher observed = regression. tolerance is fractional (e.g. 0.15 = +15%).
      const limit = baselineValue * (1 + tol);
      if (observedValue > limit) {
        failures.push({ metric, observed: observedValue, baseline: baselineValue, limit });
      }
    }
  }
  return failures;
}

async function main() {
  const baseline = await loadBaseline();
  const observed = await runLighthouse(TARGET_URL);

  console.log('[perfBaseline] Observed:', JSON.stringify(observed, null, 2));

  if (SHOULD_UPDATE) {
    const updated = {
      ...baseline,
      lighthouse: {
        performanceScore: Number(observed.performanceScore.toFixed(3)),
        lcpMs: Math.round(observed.lcpMs),
        tbtMs: Math.round(observed.tbtMs),
        clsScore: Number(observed.clsScore.toFixed(3)),
        fcpMs: Math.round(observed.fcpMs),
        tti: Math.round(observed.tti),
        speedIndex: Math.round(observed.speedIndex)
      }
    };
    await writeFile(baselinePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    console.log('[perfBaseline] Baseline updated.');
    return;
  }

  const failures = compare(observed, baseline.lighthouse, baseline.tolerance);
  if (failures.length === 0) {
    console.log('[perfBaseline] PASS — all metrics within tolerance.');
    return;
  }

  console.error('[perfBaseline] FAIL — regressions detected:');
  for (const f of failures) {
    console.error(
      `  - ${f.metric}: observed=${f.observed} baseline=${f.baseline} limit=${f.limit}`
    );
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('[perfBaseline] Error:', err);
  process.exit(2);
});
