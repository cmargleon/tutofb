/**
 * Phase-0 harness: measures the deterministic base-code resolver against a labeled gold set.
 *
 *   npm --prefix functions run build
 *   node --import tsx scripts/organizer/evaluate-base-code.ts [gold.json]
 *
 * Gold format (see tests/fixtures/organizer-base-code-gold.json): `sheet` is the client's Excel as
 * a grid (header row first) and `photos` lists filenames with the expected variant SKC,
 * `base:<code>` when the variant is left to the visual step, or null when it must be an exception.
 * Exit code 1 when any photo is assigned to a wrong product or variant (the activation criterion).
 * Visual accuracy is measured separately with the client's shadow run.
 */
import { readFileSync } from 'node:fs';
import { evaluateGold, type Gold } from './baseCodeGold';

const file = process.argv[2] || new URL('../../tests/fixtures/organizer-base-code-gold.json', import.meta.url).pathname;
const report = evaluateGold(JSON.parse(readFileSync(file, 'utf8')) as Gold);
for (const row of report.rows) console.log(`${row.ok ? 'OK   ' : row.wrong ? 'WRONG' : 'MISS '} ${row.name.padEnd(28)} expected=${String(row.expected).padEnd(20)} got=${row.got}`);
console.log(`\nTotal ${report.total} · correct ${report.correct} · wrong ${report.wrong} · missed ${report.missed} · automatic coverage ${(report.coverage * 100).toFixed(1)} %`);
process.exit(report.wrong ? 1 : 0);
