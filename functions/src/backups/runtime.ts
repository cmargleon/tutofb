import { defineBoolean, defineString } from 'firebase-functions/params';
export const BACKUPS_ENABLED = defineBoolean('DRIVE_BACKUPS_ENABLED', { default: false });
export const BACKUPS_ZONE = defineString('DRIVE_BACKUP_TIMEZONE', { default: 'America/Mexico_City' });
export const BACKUP_RUNTIME = defineString('DRIVE_BACKUP_RUNTIME', { default: 'drive-backup-runtime@tutofb-260320-1003.iam.gserviceaccount.com' });
export const WORKSPACE_RUNTIME = defineString('DRIVE_WORKSPACE_RUNTIME', { default: 'drive-workspace-runtime@tutofb-260320-1003.iam.gserviceaccount.com' });
export const CUSTODIANS = defineString('DRIVE_BACKUP_CUSTODIANS', { default: '' });
export const custodians = () => CUSTODIANS.value().split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
