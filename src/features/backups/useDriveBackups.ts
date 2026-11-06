import { useEffect, useState } from 'react';
import type { DriveBackupRequest, DriveBackupStatus } from '../../../shared/src/types/backups';
import { useRole } from '../auth/AuthProvider';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { manageBackup, subscribeBackups, subscribeBackupAudit, subscribeBackupFiles, subscribeBackupVersions, subscribeBackupRestores, type BackupFile, type BackupFileVersion, type BackupRestore, type BackupAudit } from './firebase';
export function useDriveBackups() {
  const role = useRole(); const toast = useToast(); const confirm = useConfirm();
  const [items, setItems] = useState<DriveBackupStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [versions, setVersions] = useState<BackupFileVersion[]>([]);
  const [restores, setRestores] = useState<BackupRestore[]>([]);
  const [audit, setAudit] = useState<BackupAudit[]>([]);
  useEffect(() => {
    if (!role.isAdmin || !role.isActive) return;
    return subscribeBackups(setItems, error => setError(error.message));
  }, [role.isAdmin, role.isActive]);
  useEffect(() => {
    setAudit([]); if (!selected || !role.isAdmin || !role.isActive) return;
    const onError = (error: Error) => setError(error.message);
    const stops = [subscribeBackupAudit(selected, setAudit, onError), subscribeBackupFiles(selected, setFiles, onError),
      subscribeBackupVersions(selected, setVersions, onError), subscribeBackupRestores(selected, setRestores, onError)];
    return () => { stops.forEach(stop => stop()); setFiles([]); setVersions([]); setRestores([]); };
  }, [selected, role.isAdmin, role.isActive]);
  const submit = async (request: DriveBackupRequest) => {
    if (request.action === 'restore' && !await confirm({ title: 'Restaurar desde el respaldo',
      description: 'Se crearán copias en una carpeta de restauración independiente dentro del espacio de trabajo del cliente.',
      impact: 'La restauración conserva los archivos de trabajo existentes y consume almacenamiento adicional.', confirmLabel: 'Restaurar', tone: 'info' })) return;
    setBusy(true);
    try { const result = await manageBackup(request); toast({ title: result.message, tone: 'success' }); }
    catch (error) { toast({ title: 'No se pudo completar la solicitud', description: error instanceof Error ? error.message : 'Error de respaldo', tone: 'error' }); }
    finally { setBusy(false); }
  };
  return { items, error, busy, selected, setSelected, audit, files, versions, restores, submit };
}
