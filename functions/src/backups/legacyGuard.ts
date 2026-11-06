import { getAppFirestore } from '../firebase/appFirestore';
/** Defense in depth for pre-existing writer integrations. Never changes Drive permissions. */
export async function assertLegacyDriveDestination(fileId: string, lineage: (id: string) => Promise<{ id: string; driveId?: string; parents?: string[]; appProperties?: Record<string, string> }>) {
  const configs = await getAppFirestore().collection('driveBackups').get();
  if (configs.empty) return;
  const protectedRoots = new Set(configs.docs.flatMap(d => [d.data().sourceFolderId, d.data().backupFolderId]));
  const seen = new Set<string>(); let next: string | undefined = fileId;
  for (let depth = 0; next && depth < 100; depth++) {
    if (protectedRoots.has(next) || seen.has(next)) throw new Error('Las integraciones heredadas no pueden escribir en originales o respaldos protegidos.');
    seen.add(next); const file = await lineage(next);
    if (file.appProperties?.backupClient || file.driveId && protectedRoots.has(file.driveId)) throw new Error('Destino de respaldo protegido.');
    if ((file.parents?.length || 0) > 1) throw new Error('Destino ambiguo.');
    next = file.parents?.[0];
    if (!next) {
      if (file.driveId === file.id || (await lineage('root')).id === file.id) return;
      throw new Error('No se pudo probar la raíz del destino; escritura denegada.');
    }
  }
  if (next) throw new Error('No se pudo verificar el destino.');
}
