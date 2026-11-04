import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const admin=require('../functions/node_modules/firebase-admin');
admin.initializeApp({projectId:'demo-manglar-inventory',storageBucket:'demo-manglar-inventory.appspot.com'});
const {MANGLAR_OPERATIONS}=require('../functions/lib/functions/src/manglar/operations.js');
const {MANGLAR_MCP_TOOLS}=require('../functions/lib/functions/src/automation/mcp.js');
for(const op of MANGLAR_OPERATIONS)if(!fs.existsSync(op.source))throw new Error(`Inventory source missing: ${op.source}`);
const labels={read:'Lectura directa',write:'Cambio reversible + idempotencyKey',paid:'Presupuesto y confirmación exactos',critical:'Confirmación exacta',destructive:'Confirmación destructiva exacta'};
let text=`# Inventario de operaciones MCP\n\n${MANGLAR_MCP_TOOLS.length} herramientas publicadas; ${MANGLAR_OPERATIONS.length} operaciones por dominio, además de las siete herramientas históricas. Generado desde el registro ejecutable con \`node scripts/generate-manglar-inventory.mjs\` después de compilar Functions.\n\nCada fila está implementada, validada por contrato y compilada. Las pruebas en emuladores verifican los dominios y recorridos descritos en [la guía](MANGLAR_CHATGPT_PLUGIN.md); no afirman que cada fila haya sido ejecutada desde una cuenta real de ChatGPT.\n\n| Operación | Herramienta / acción | Roles | Control | Servicio / fuente |\n|---|---|---|---|---|\n`;
for(const op of [...MANGLAR_OPERATIONS].sort((a,b)=>`${a.domain}.${a.action}`.localeCompare(`${b.domain}.${b.action}`))){
 text+=`| ${op.domain}.${op.action} | \`manglar_${op.domain}\` → \`${op.action}\` | ${op.roles.join(', ')} | ${labels[op.risk]} | [${op.source}](../${op.source}) |\n`;
}
text+='\n## Herramientas de control y compatibilidad\n\n';
for(const tool of MANGLAR_MCP_TOOLS.filter(tool=>!MANGLAR_OPERATIONS.some(op=>tool.name===`manglar_${op.domain}`)))text+=`- \`${tool.name}\`: ${tool.description}\n`;
fs.writeFileSync('docs/MANGLAR_TOOL_INVENTORY.md',text);
console.log(`${MANGLAR_MCP_TOOLS.length} tools; ${MANGLAR_OPERATIONS.length} domain operations; all source paths exist.`);
await admin.app().delete();
