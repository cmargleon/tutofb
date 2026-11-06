import { execFileSync } from 'node:child_process';
import { requireFunctions, PILOT } from './catalog.ts';

const project = 'tutofb-260320-1003';
export const cloudToken = () => execFileSync('gcloud', ['auth', 'print-access-token', '--project', project], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
}).trim();
export const secret = (name: 'GOOGLE_PRIVATE_KEY' | 'GEMINI_API_KEY') =>
  execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret', name, '--project', project], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  }).trim();
export function sourceToken(): () => Promise<string> {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  if (!email) throw new Error('Configura GOOGLE_CLIENT_EMAIL mediante el archivo de entorno existente de Functions');
  const { JWT } = requireFunctions('google-auth-library') as typeof import('../../functions/node_modules/google-auth-library');
  const jwt = new JWT({
    email, key: secret('GOOGLE_PRIVATE_KEY').replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return async () => {
    const { token } = await jwt.getAccessToken();
    if (!token) throw new Error('Google no entregó un token de lectura');
    return token;
  };
}
export async function authorizePilot() {
  const token = cloudToken();
  const database = process.env.FIRESTORE_DATABASE_ID || '(default)';
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(database)}/documents`;
  const get = async (path: string) => {
    const response = await fetch(`${base}/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Firestore HTTP ${response.status}`);
    return (await response.json()).fields;
  };
  const [client, system] = await Promise.all([get(`clients/${PILOT.clientId}`), get('system_config/main')]);
  const automation = client?.automation?.mapValue?.fields;
  if (client?.name?.stringValue !== PILOT.client || client?.status?.stringValue !== 'active' ||
      automation?.enabled?.booleanValue !== true ||
      !automation?.driveFolderIds?.arrayValue?.values?.some((value: { stringValue?: string }) => value.stringValue === PILOT.sourceId)) {
    throw new Error('El cliente o la carpeta no están autorizados para el piloto');
  }
  const readNumber = (field: { doubleValue?: number; integerValue?: string } | undefined) =>
    Number(field?.doubleValue ?? field?.integerValue ?? Number.POSITIVE_INFINITY);
  return Math.min(2, readNumber(system?.automationBudget?.mapValue?.fields?.maxBudgetUsd),
    readNumber(automation.budgetUsd));
}
