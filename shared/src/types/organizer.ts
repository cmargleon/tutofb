export const ORGANIZER_DEFAULT_BUDGET_USD = 40;
export const DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED = true;
export const ORGANIZER_DEFAULT_MODEL = 'gemini-3.1-flash-lite';
export const ORGANIZER_CATALOG_DIRECTORY = '05 - CATALOGO';
export const ORGANIZER_LIMITS = { maxCalls: 300, inputTokens: 16384, outputTokens: 4096 };
export const ORGANIZER_DIRECTORIES = {
  sources: '00 - FUENTES',
  pending: '01 - PENDIENTES',
  review: '02 - REVISAR',
  uploaded: '03 - SUBIDOS SEGÚN EXCEL',
  reports: '04 - REPORTES',
};

export interface OrganizerSettings {
  sourceIds: string[];
  parentId: string;
  folderName: string;
  enabled: boolean;
  debounceMinutes: number;
  budgetUsd: number;
  model: string;
  escalationModel: string | null;
  minimumConfidence: number;
  controlSheet: boolean;
  allowInheritedAccess: boolean;
  directories: typeof ORGANIZER_DIRECTORIES;
  operatorUids: string[];
  maxCalls?: number;
}

export interface OrganizerConfig extends OrganizerSettings {
  clientId: string;
  clientName: string;
  destinationId: string | null;
  activeRunId: string | null;
  watcher: 'disabled' | 'idle' | 'collecting' | 'running' | 'error';
  lastSyncAt: number | null;
  lastClassifiedAt: number | null;
  watcherError: string | null;
  lastPollAt: number | null;
}

export type OrganizerRunStatus = 'queued' | 'running' | 'paused' | 'cancelled' | 'budget_exhausted' | 'failed' | 'completed';
export type OrganizerMode = 'inventory' | 'dry_run' | 'classify' | 'sync';
export interface OrganizerRun {
  id: string;
  clientId: string;
  mode: OrganizerMode;
  status: OrganizerRunStatus;
  phase: 'inventory' | 'catalog' | 'copy' | 'vision' | 'organize' | 'automation' | 'report';
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  createdBy: string;
  budgetUsd: number;
  estimatedUsd: number;
  reservedUsd: number;
  uncertainUsd: number;
  alerts: number[];
  calls: number;
  counts: Record<string, number>;
  error: string | null;
  reportUrl: string | null;
  controlSheetUrl: string | null;
  planRunId?: string | null;
}

export interface OrganizerSourceCell {
  column: string;
  value: string;
  originalValue: string | number | boolean;
  field: string;
}
export interface OrganizerProductRow {
  fileId: string;
  fileName: string;
  tab: string;
  tabId: number | null;
  line: number;
  cells: OrganizerSourceCell[];
  skc: string;
  sku: string;
  base: string;
  name: string;
  category: string;
  color: string;
  size: string;
  pack: string;
  photo: string;
  upload: string;
  publish: string;
  comments: string;
  description?: string;
  capacity?: string;
  inferred?: { field: string; fromLine: number; reason: string }[];
  sourceVersion?: string;
}

export type OrganizerDocumentStatus = 'ok' | 'pending' | 'review' | 'unrecorded';

export interface OrganizerVariant {
  id: string;
  base: string;
  visual: string;
  name: string;
  color: string;
  pack: string;
  category: string;
  skcs: string[];
  skus: string[];
  sizes: string[];
  status: 'pending' | 'review' | 'uploaded';
  issues: string[];
  documented: Record<'photo' | 'upload' | 'publish', OrganizerDocumentStatus>;
  referenceState: 'pending' | 'suggested' | 'approved' | 'rejected';
  references: { front: string[]; back: string[]; main: string[]; complementary?: string[] };
  driveFolderUrl: string | null;
  capacity?: string;
  catalogFingerprint?: string;
  description?: string;
  sourceTabs?: string[];
}

export interface OrganizerPhoto {
  id: string;
  name: string;
  path: string[];
  sourceUrl: string;
  copyUrl: string | null;
  variantId: string | null;
  candidates: string[];
  method: string;
  evidence: string[];
  confidence: number;
  issue: string | null;
  duplicateOf: string | null;
  reviewedBy: string | null;
  view: string | null;
  visualHint?: { groupId: string; label: string; color: string; pack: string; kind: string };
  variantIds?: string[];
  referenceEligibleFor?: string[];
  baseId?: string | null;
  identityState?: 'unresolved' | 'base' | 'variant' | 'shared' | 'needs_review';
  candidateDetails?: { id: string; label: string; score: number; evidence: string[] }[];
  quality?: number;
  provisionalCode?: string | null;
}

export interface OrganizerBaseProduct {
  id: string;
  code: string;
  name: string;
  variants: string[];
}
export interface OrganizerCommercialVariant {
  id: string;
  variantId: string;
  skc: string;
  sku: string;
  size: string;
  pack: string;
}
export interface OrganizerPage<T> { items: T[]; next: string | null }
export interface OrganizerTab {
  id: string;
  fileId: string;
  fileName: string;
  name: string;
  tabId: number | null;
  headerRow: number | null;
  imported: number;
  skipped: number;
  issue: string | null;
  samples?: { values: string[]; originalValues?: (string | number | boolean)[] }[];
  sampleStartRow?: number;
  links?: { url: string; cell: string; sourceId: string | null }[];
  columnMap?: string[];
}
export interface OrganizerPlanItem {
  id: string;
  name: string;
  sourcePath: string[];
  destination: string[];
  action: 'copy' | 'place' | 'reuse' | 'retain_legacy';
  reason: string;
  currentFolderUrl?: string | null;
}
export interface OrganizerInterpretation {
  resolved: boolean;
  folders: { fileId: string; role: 'product' | 'category' | 'mixed' | 'unknown'; evidence: string[] }[];
  columns: { tabId: string; headerRow: number; fields: string[]; evidence: string[] }[];
  conventions: { description: string; evidence: string[] }[];
  relationships: { variantIds: string[]; kind: 'base' | 'visual' | 'commercial' | 'shared'; evidence: string[] }[];
  unresolved: string[];
}
export type OrganizerRequest =
  | { action: 'clients'; cursor?: string }
  | { action: 'config'; clientId: string }
  | { action: 'configure'; clientId: string; settings: OrganizerSettings }
  | { action: 'start'; clientId: string; mode: OrganizerMode; requestId: string; confirmedBudgetUsd?: number; photoIds?: string[]; variantId?: string; planRunId?: string }
  | { action: 'run' | 'pause' | 'resume' | 'cancel' | 'report'; clientId: string; runId: string }
  | { action: 'runs' | 'products' | 'photos' | 'conflicts' | 'tabs'; clientId: string; cursor?: string; variantId?: string; runId?: string; status?: OrganizerVariant['status'] }
  | { action: 'baseProducts' | 'commercial'; clientId: string; cursor?: string; variantId?: string }
  | { action: 'files' | 'ledger' | 'plan'; clientId: string; runId: string; cursor?: string }
  | { action: 'interpretations'; clientId: string; cursor?: string }
  | { action: 'provenance'; clientId: string; variantId: string; cursor?: string }
  | { action: 'draft'; clientId: string; variantId: string }
  | { action: 'thumbnail'; clientId: string; photoId: string }
  | { action: 'correct'; clientId: string; photoId: string; variantId: string | null; variantIds?: string[]; photoIds?: string[]; referenceVariantIds?: string[] }
  | { action: 'references'; clientId: string; variantId: string; decision: 'approve' | 'reject' | 'reset' };
export interface OrganizerDraft {
  name: string;
  kind: 'garment' | 'product';
  color: string;
  photos: { name: string; base64: string; view: 'front' | 'back' | 'side' | null }[];
}
export interface OrganizerRunFile {
  id: string;
  name: string;
  path: string[];
  version: string;
  added: boolean;
  changed: boolean;
  copied: boolean;
  error: string | null;
}
export interface OrganizerLedgerItem {
  id: string;
  state: 'reserved' | 'confirmed' | 'uncertain';
  model: string;
  startedAt: number;
  settledAt?: number;
  reserve: number;
  usage?: { input: number; output: number; thinking: number } | null;
  costUsd?: number | null;
  error?: string | null;
}
export interface OrganizerClient {
  id: string;
  name: string;
  configured: boolean;
  driveFolderIds?: string[];
}

export type OrganizerResponse = OrganizerDraft | { mimeType: 'image/jpeg'; base64: string } | OrganizerConfig | OrganizerRun | OrganizerVariant | OrganizerPhoto | null
  | OrganizerPage<OrganizerClient>
  | OrganizerPage<OrganizerRun | OrganizerVariant | OrganizerPhoto | OrganizerProductRow | OrganizerTab | OrganizerRunFile | OrganizerLedgerItem | OrganizerBaseProduct | OrganizerCommercialVariant | OrganizerPlanItem | OrganizerInterpretation>
  | { run: OrganizerRun; reportUrl: string | null; controlSheetUrl: string | null };
