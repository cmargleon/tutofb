import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const guard = fileURLToPath(new URL('./test-emulator-guard.mjs', import.meta.url));
const result = spawnSync('npm', ['test'], { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${JSON.stringify(guard)}` } });
process.exit(result.status ?? 1);
