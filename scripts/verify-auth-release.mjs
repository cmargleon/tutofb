// Read-only inventory. Build Functions, then pass firebase functions:list --json output.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-auth-release.mjs <functions-list.json>');
const root = process.cwd();
const ts = require(path.join(root, 'node_modules/typescript'));
const index = path.join(root, 'functions/src/index.ts');
const roles = path.join(root, 'functions/src/auth/roles.ts');
const graph = new Map();

// Include dynamic imports: MCP invokes many existing callables through its registry.
function scan(file) {
  if (graph.has(file)) return;
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const dependencies = [];
  graph.set(file, dependencies);
  function visit(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
      const base = path.resolve(path.dirname(file), specifier.text);
      const resolved = [`${base}.ts`, path.join(base, 'index.ts'), base.endsWith('.json') ? base : '']
        .find(candidate => candidate && fs.existsSync(candidate));
      if (!resolved) throw new Error(`Unresolved dependency ${specifier.text} in ${file}`);
      dependencies.push(resolved);
      if (!resolved.endsWith('.json')) scan(resolved);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
function incorporatesRoles(file, seen = new Set()) {
  if (file === roles) return true;
  if (seen.has(file)) return false;
  seen.add(file);
  return (graph.get(file) || []).some(dependency => incorporatesRoles(dependency, seen));
}
scan(index);
const program = ts.createProgram([index], { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, noEmit: true });
const checker = program.getTypeChecker();
const source = program.getSourceFile(index);
const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
// Loading definitions must not configure a production client. No handlers are invoked.
process.env.GCLOUD_PROJECT = 'demo-auth-inventory';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-auth-inventory', storageBucket: 'demo-auth-inventory.appspot.com' });
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const runtime = require(path.join(root, 'functions/lib/functions/src/index.js'));
const local = [];
for (let symbol of exports) {
  const id = symbol.name;
  const endpoint = runtime[id]?.__endpoint;
  if (!endpoint) continue; // Exported internal services are not deployed endpoints.
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const file = symbol.declarations?.[0]?.getSourceFile().fileName;
  if (!file) throw new Error(`Missing source for ${id}`);
  const kind = endpoint.callableTrigger ? 'callable' : endpoint.httpsTrigger ? 'http'
    : endpoint.eventTrigger ? 'event' : endpoint.scheduleTrigger ? 'schedule' : 'other';
  local.push({ id, source: path.relative(root, file), kind, incorporatesRoles: incorporatesRoles(file) });
}
const deployed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).result;
if (!Array.isArray(deployed) || deployed.some(endpoint => endpoint.project !== 'tutofb-260320-1003')) {
  throw new Error('Expected the Tuto deployed Functions inventory');
}
const remoteOnly = deployed.filter(endpoint => !local.some(candidate => candidate.id === endpoint.id));
const localOnly = local.filter(endpoint => !deployed.some(candidate => candidate.id === endpoint.id));
if (remoteOnly.length || localOnly.length) {
  throw new Error(JSON.stringify({ remoteOnly: remoteOnly.map(endpoint => endpoint.id), localOnly }));
}
const affected = local.filter(endpoint => endpoint.incorporatesRoles).map(endpoint => {
  const remote = deployed.find(candidate => candidate.id === endpoint.id);
  if (remote.region !== 'us-central1' || remote.state !== 'ACTIVE') throw new Error(`Unexpected deployment state: ${endpoint.id}`);
  const remoteKind = remote.callableTrigger ? 'callable' : remote.httpsTrigger ? 'http'
    : remote.eventTrigger ? 'event' : remote.scheduleTrigger ? 'schedule' : 'other';
  if (endpoint.kind !== remoteKind) throw new Error(`Trigger mismatch: ${endpoint.id}`);
  return { ...endpoint, region: remote.region, hash: remote.hash };
}).sort((a, b) => a.id.localeCompare(b.id));
console.log(JSON.stringify({ localCount: local.length, deployedCount: deployed.length, affected,
  unaffected: local.filter(endpoint => !endpoint.incorporatesRoles) }, null, 2));
