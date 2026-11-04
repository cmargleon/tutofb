// Explicit JSON schemas from the same TypeScript contracts used by UI and Functions.
// Run after changing a request contract; never infer schemas from arbitrary runtime objects.
import ts from 'typescript';
import fs from 'node:fs';
const config = ts.readConfigFile('functions/tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, 'functions');
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const source = program.getSourceFile('shared/src/types/index.ts') || program.getSourceFiles().find(f => f.fileName.endsWith('/shared/src/types/index.ts'));
const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
const defs = {};
function schema(type, name = '') {
  const f = type.flags;
  if (f & ts.TypeFlags.Any || f & ts.TypeFlags.Unknown) return { anyOf: [{ type:'string',maxLength:30000 },{type:'number'},{type:'boolean'},{type:'null'}] };
  if (f & ts.TypeFlags.StringLiteral) return { const: type.value, type:'string' };
  if (f & ts.TypeFlags.NumberLiteral) return { const: type.value, type:'number' };
  if (f & ts.TypeFlags.BooleanLiteral) return { const: type.intrinsicName === 'true',type:'boolean' };
  if (f & ts.TypeFlags.String) return { type:'string', maxLength: 30000 };
  if (f & ts.TypeFlags.Number) return { type:'number' };
  if (f & ts.TypeFlags.Boolean) return { type:'boolean' };
  if (f & ts.TypeFlags.Null) return { type:'null' };
  if (f & ts.TypeFlags.Undefined || f & ts.TypeFlags.Never) return false;
  if (type.isUnion()) {
    const types = type.types.filter(t => !(t.flags & ts.TypeFlags.Undefined));
    if (types.every(t => t.flags & ts.TypeFlags.StringLiteral)) return {type:'string',enum:types.map(t=>t.value)};
    if (types.length === 1) return schema(types[0]);
    return {anyOf:types.map(t=>schema(t))};
  }
  if (checker.isArrayType(type)) return {type:'array',maxItems:100,items:schema(checker.getTypeArguments(type)[0])};
  const properties = {}; const required = [];
  for (const p of checker.getPropertiesOfType(type)) {
    if (p.name.startsWith('__')) throw Error(`Unexpected property ${p.name}`);
    const declaration = p.valueDeclaration || p.declarations?.[0];
    properties[p.name] = schema(checker.getTypeOfSymbolAtLocation(p, declaration));
    const restrict = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.anyOf) node.anyOf.forEach(restrict);
      if (node.type === 'number' && ['count','limit','chunkSize','sizeBytes','sourceIndex','maxReviewAttempts','maxOperationalRetries','jobMaxRetries','jobRetryDelayMs','batchMaxJobs'].includes(p.name)) {
        node.type='integer';node.minimum=p.name==='sourceIndex'||p.name==='jobMaxRetries'||p.name==='jobRetryDelayMs'||p.name==='maxOperationalRetries'?0:1;
        if(p.name==='count')node.maximum=12;if(p.name==='limit')node.maximum=100;if(p.name==='chunkSize')node.maximum=5;
      }
      if(node.type==='array' && ['jobs','photos','inputImages','referencePaths','fields'].includes(p.name)){
        node.maxItems=({jobs:50,photos:4,inputImages:40,referencePaths:4,fields:50})[p.name];
      }
    };
    restrict(properties[p.name]);
    if (!(p.flags & ts.SymbolFlags.Optional)) required.push(p.name);
  }
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  return {type:'object',properties,required,additionalProperties:index ? schema(index) : false, maxProperties: 100};
}
for (const symbol of symbols) {
  if (!/(Request$|^Manglar.*Request$)/.test(symbol.name)) continue;
  const real = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const type = checker.getDeclaredTypeOfSymbol(real);
  // TimestampLike has SDK internals; request inputs only accept ISO representations of timestamps.
  defs[symbol.name] = schema(type);
}
const output=JSON.stringify(defs,null,2)+'\n';
if(process.argv.includes('--check')) { if(fs.readFileSync('functions/src/manglar/contracts.json','utf8')!==output) throw new Error('MCP schemas are stale; run node scripts/generate-manglar-schemas.mjs'); }
else fs.writeFileSync('functions/src/manglar/contracts.json',output);
console.log(`Generated ${Object.keys(defs).length} request schemas.`);
