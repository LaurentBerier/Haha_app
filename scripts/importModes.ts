import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import type { ArtistModeData, Mode } from '../src/models/Mode';
import type { PersonalityProfile } from '../src/models/Artist';

const WORKBOOK_FILE = 'HiHa_Cathy_Liste_Complete_Par_Mode.xlsx';
const LIST_SHEET = 'ListOfModeAndFeatures';
const RULES_SHEET = 'Regle';

const MODE_ID_OVERRIDES: Record<string, string> = {
  'radar d attitude': 'radar-attitude',
  roast: 'roast',
  'coach de vie': 'coach-de-vie',
  'phrase du jour': 'phrase-du-jour',
  'message personnalise': 'message-personnalise',
  'numero de show': 'numero-de-show',
  'numero show': 'numero-de-show',
  horoscope: 'horoscope',
  meteo: 'meteo'
};

const HARD_RULE_CATEGORIES = new Set(['interdits absolus', 'attaques personnelles']);

function canonicalize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return canonicalize(value).replace(/ /g, '-');
}

function stripLeadingEmoji(value: string): string {
  return value.replace(/^\p{Extended_Pictographic}+\s*/u, '').trim();
}

function extractLeadingEmoji(value: string): string | undefined {
  const match = value.match(/^(\p{Extended_Pictographic}+)/u);
  return match?.[1];
}

function modeIdFromLabel(label: string): string {
  const canonical = canonicalize(stripLeadingEmoji(label));
  return MODE_ID_OVERRIDES[canonical] ?? slugify(label);
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function getRows(workbook: xlsx.WorkBook, sheetName: string): string[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Missing sheet: ${sheetName}`);
  }

  return xlsx.utils
    .sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })
    .map((row) => row.map((cell) => String(cell ?? '').trim()));
}

function parseModes(workbook: xlsx.WorkBook): Mode[] {
  const rows = getRows(workbook, LIST_SHEET);
  const modes: Mode[] = [];

  for (const row of rows.slice(1)) {
    const rawName = row[0] ?? '';
    const description = row[1] ?? '';
    if (!rawName) {
      continue;
    }

    const name = stripLeadingEmoji(rawName);
    modes.push({
      id: modeIdFromLabel(rawName),
      name,
      description: description || `Mode ${name}.`,
      emoji: extractLeadingEmoji(rawName)
    });
  }

  return modes;
}

function parseGuardrails(workbook: xlsx.WorkBook): PersonalityProfile['guardrails'] {
  const rows = getRows(workbook, RULES_SHEET);
  const hardNo: string[] = [];
  const softZones: { topic: string; rule: string }[] = [];

  for (const row of rows.slice(1)) {
    const category = row[1] ?? '';
    const rule = row[2] ?? '';
    if (!category || !rule) {
      continue;
    }

    if (HARD_RULE_CATEGORIES.has(canonicalize(category))) {
      hardNo.push(rule);
      continue;
    }

    softZones.push({ topic: category, rule });
  }

  return { hardNo, softZones };
}

function buildHeaderIndex(headers: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  headers.forEach((header, i) => {
    index[canonicalize(header)] = i;
  });
  return index;
}

function parseFewShots(workbook: xlsx.WorkBook): ArtistModeData[] {
  const excluded = new Set([RULES_SHEET, LIST_SHEET]);
  const byModeId = new Map<string, ArtistModeData>();

  for (const sheetName of workbook.SheetNames) {
    if (excluded.has(sheetName)) {
      continue;
    }

    const rows = getRows(workbook, sheetName);
    if (!rows.length) {
      continue;
    }

    const headerIndex = buildHeaderIndex(rows[0] ?? []);
    const modeColumn = headerIndex.mode;
    const contextColumn = headerIndex.contexte;
    const variablesColumn = headerIndex['variables si applicable'];
    const inputColumn = headerIndex['input utilisateur'];
    const responseColumn = headerIndex['reponse cathy'];

    for (const row of rows.slice(1)) {
      const input = inputColumn === undefined ? '' : row[inputColumn] ?? '';
      const response = responseColumn === undefined ? '' : row[responseColumn] ?? '';
      if (!input || !response) {
        continue;
      }

      const modeLabelFromRow = modeColumn === undefined ? '' : row[modeColumn] ?? '';
      const modeLabel = modeLabelFromRow || sheetName;
      const modeId = modeIdFromLabel(modeLabel);

      const examples = byModeId.get(modeId) ?? { modeId, examples: [] };
      examples.examples.push({
        input,
        response,
        context: contextColumn === undefined ? undefined : row[contextColumn] || undefined,
        variables: variablesColumn === undefined ? undefined : row[variablesColumn] || undefined
      });
      byModeId.set(modeId, examples);
    }
  }

  return Array.from(byModeId.values());
}

function writeModesFile(rootDir: string, modes: Mode[]): void {
  const outputPath = path.join(rootDir, 'src/config/modes.ts');
  const content = `/* auto-generated by scripts/importModes.ts; DO NOT EDIT MANUALLY */\n` +
    `import type { Mode } from '../models/Mode';\n\n` +
    `export const modes: Mode[] = ${serialize(modes)};\n\n` +
    `export const modesById: Record<string, Mode> = modes.reduce<Record<string, Mode>>((acc, mode) => {\n` +
    `  acc[mode.id] = mode;\n` +
    `  return acc;\n` +
    `}, {});\n\n` +
    `export function getModeById(modeId: string): Mode | null {\n` +
    `  return modesById[modeId] ?? null;\n` +
    `}\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
}

function writeModeFewShotsFile(
  rootDir: string,
  data: ArtistModeData[],
  guardrails: PersonalityProfile['guardrails']
): void {
  const outputPath = path.join(rootDir, 'src/data/cathy-gauthier/modeFewShots.ts');
  const content = `/* auto-generated by scripts/importModes.ts; DO NOT EDIT MANUALLY */\n` +
    `import type { PersonalityProfile } from '../../models/Artist';\n` +
    `import type { ArtistModeData, FewShotExample } from '../../models/Mode';\n\n` +
    `export const cathyModeFewShots: ArtistModeData[] = ${serialize(data)};\n\n` +
    `export const cathyGuardrails: PersonalityProfile['guardrails'] = ${serialize(guardrails)};\n\n` +
    `export function getCathyModeFewShots(modeId: string): FewShotExample[] {\n` +
    `  return cathyModeFewShots.find((entry) => entry.modeId === modeId)?.examples ?? [];\n` +
    `}\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
}

function main(): void {
  const rootDir = process.cwd();
  const workbookPath = path.join(rootDir, WORKBOOK_FILE);
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  const workbook = xlsx.readFile(workbookPath);
  const modes = parseModes(workbook);
  const fewShots = parseFewShots(workbook);
  const guardrails = parseGuardrails(workbook);

  writeModesFile(rootDir, modes);
  writeModeFewShotsFile(rootDir, fewShots, guardrails);

  console.log(`Imported ${modes.length} modes and ${fewShots.length} mode datasets.`);
}

main();
