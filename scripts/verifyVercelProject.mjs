/* global console, process */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXPECTED_PROJECT_NAME = 'haha-app';
const EXPECTED_TEAM_SCOPE = 'snadeau-breakingwalls-projects';
const EXPECTED_ORG_ID = 'team_U9WWpAPb1qiHoLZfKlWMHwDo';

const projectConfigPath = resolve('.vercel/project.json');

if (!existsSync(projectConfigPath)) {
  console.error('[deploy guard] Missing .vercel/project.json');
  console.error(
    `[deploy guard] Run: npx vercel link --project ${EXPECTED_PROJECT_NAME} --scope ${EXPECTED_TEAM_SCOPE} --yes`
  );
  process.exit(1);
}

let projectConfig;
try {
  projectConfig = JSON.parse(readFileSync(projectConfigPath, 'utf8'));
} catch (error) {
  console.error('[deploy guard] Could not parse .vercel/project.json');
  console.error(error);
  process.exit(1);
}

const issues = [];
if (projectConfig.projectName !== EXPECTED_PROJECT_NAME) {
  issues.push(`projectName="${projectConfig.projectName}" (expected "${EXPECTED_PROJECT_NAME}")`);
}
if (projectConfig.orgId !== EXPECTED_ORG_ID) {
  issues.push(`orgId="${projectConfig.orgId}" (expected "${EXPECTED_ORG_ID}")`);
}

if (issues.length > 0) {
  console.error('[deploy guard] Wrong Vercel link detected.');
  for (const issue of issues) {
    console.error(`[deploy guard] ${issue}`);
  }
  console.error(
    `[deploy guard] Fix with: npx vercel link --project ${EXPECTED_PROJECT_NAME} --scope ${EXPECTED_TEAM_SCOPE} --yes`
  );
  console.error('[deploy guard] Do NOT deploy from lbernier-2067s-projects for this repo.');
  process.exit(1);
}

console.log(`[deploy guard] OK: ${EXPECTED_TEAM_SCOPE}/${EXPECTED_PROJECT_NAME}`);
