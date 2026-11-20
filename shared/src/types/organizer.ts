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
  /** @deprecated Ignored: Drive is read-only. */
  parentId?: string;
  /** @deprecated Ignored: Drive is read-only. */
  folderName?: string;
  enabled: boolean;
  debounceMinutes: number;
  budgetUsd: number;
  model: string;
  escalationModel: string | null;
  minimumConfidence: number;
  controlSheet: boolean;
  /** @deprecated Ignored: Drive is read-only. */
  allowInheritedAccess?: boolean;
  /** @deprecated Ignored: Drive is read-only. */
  directories?: typeof ORGANIZER_DIRECTORIES;
  operatorUids: string[];
  maxCalls?: number;
  /** Absolute call maximum per run; the run limit scales with its photos between `maxCalls` and this cap. */
  maxCallsCap?: number;
  /** Absolute USD maximum per run; the run budget scales with its photos between `budgetUsd` and this cap. */
  budgetCapUsd?: number;
  /** legacy: current association; shadow: base-code resolver computed and recorded only; baseCode: base-code resolver drives identity. */
  identityMode?: OrganizerIdentityMode;
}
export const ORGANIZER_IDENTITY_MODES = ['legacy', 'shadow', 'baseCode'] as const;
export type OrganizerIdentityMode = typeof ORGANIZER_IDENTITY_MODES[number];

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
export type OrganizerMode = 'inventory' | 'dry_run' | 'classify' | 'sync' | 'generate';
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
  header?: string;
  value: string;
  originalValue: string | number | boolean;
  calculatedValue?: number;
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
  /** The base code was read from a declared base column (SPU / Código base), not derived. */
  baseDeclared?: boolean;
}

/** Result of the deterministic base-code resolver plus, when applicable, the closed-set visual choice. */
export interface OrganizerBaseCodeIdentity {
  baseCode: string | null;
  baseId: string | null;
  variantId: string | null;
  candidates: string[];
  method: 'codigo_variante' | 'codigo_base_unico' | 'codigo_base' | 'sin_codigo' | 'codigo_base_conflicto' | 'varios_codigos';
  issue: string | null;
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
  /** Base-code resolution (active in baseCode mode, informational in shadow mode). */
  baseCodeIdentity?: OrganizerBaseCodeIdentity;
  /** The visible product contradicts the declared code or the variant's attributes. */
  concordance?: { matches: boolean; reason: string } | null;
}

export interface OrganizerBaseProduct {
  id: string;
  code: string;
  name: string;
  variants: string[];
  declared?: boolean;
  /** The same declared base code describes different products in the Excel. */
  conflict?: string | null;
  /** Canonical master catalog binding (clients/{clientId}/products/{productId}). */
  catalogProductId?: string | null;
  catalogIssue?: string | null;
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
  action: 'read';
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
export interface OrganizerProductContext {
  clientId: string;
  baseProductId: string;
  variantId: string;
}

export interface OrganizerBatchOrigin extends Omit<OrganizerProductContext, 'clientId'> {
  itemId: string;
}

export interface OrganizerGeneration {
  batchId: string;
  createdAt: number;
  itemIds: string[];
  masterProductIds: string[];
  approved: number;
  attention: number;
  inProgress: number;
  cancelled: number;
}

export interface OrganizerProductWorkflow {
  context: OrganizerProductContext;
  baseName: string;
  variant: OrganizerVariant;
  variants: Array<Pick<OrganizerVariant, 'id' | 'visual' | 'color' | 'pack' | 'capacity'>>;
  references: Array<{ id: string; name: string; sourceUrl: string | null; view: string }>;
  generations: OrganizerGeneration[];
  pendingAutomation: number;
}

export type OrganizerRequest =
  | { action: 'clients'; cursor?: string }
  | { action: 'config'; clientId: string }
  | { action: 'configure'; clientId: string; settings: OrganizerSettings }
  | { action: 'start'; clientId: string; mode: OrganizerMode; requestId: string; confirmedBudgetUsd?: number; photoIds?: string[]; variantId?: string; planRunId?: string }
  | { action: 'run' | 'pause' | 'resume' | 'cancel' | 'report'; clientId: string; runId: string }
  | { action: 'catalogAlerts'; clientId: string; batchId: string }
  | { action: 'runs' | 'products' | 'photos' | 'conflicts' | 'tabs'; clientId: string; cursor?: string; variantId?: string; runId?: string; status?: OrganizerVariant['status']; photoId?: string }
  | { action: 'baseProducts' | 'commercial'; clientId: string; cursor?: string; variantId?: string }
  | { action: 'files' | 'ledger' | 'plan'; clientId: string; runId: string; cursor?: string }
  | { action: 'interpretations'; clientId: string; cursor?: string }
  | { action: 'provenance'; clientId: string; variantId: string; cursor?: string }
  | { action: 'workflow'; clientId: string; variantId: string; baseProductId?: string; batchId?: string }
  | { action: 'draft'; clientId: string; variantId: string; baseProductId?: string }
  | { action: 'thumbnail'; clientId: string; photoId: string }
  | { action: 'linkCandidates'; clientId: string; photoId: string }
  | { action: 'previewLink'; clientId: string; photoId: string; variantId: string }
  | { action: 'link'; clientId: string; photoId: string; variantId: string; previewToken: string; requestId: string; resolutions?: Record<string, 'source' | 'target' | 'excel'> }
  | { action: 'correct'; clientId: string; photoId: string; variantId: string | null; variantIds?: string[]; photoIds?: string[]; referenceVariantIds?: string[] }
  | { action: 'references'; clientId: string; variantId: string; decision: 'approve' | 'reject' | 'reset' };
export interface OrganizerDraft {
  context?: OrganizerProductContext;
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
  copied?: boolean;
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

export interface OrganizerLinkCandidate {
  variantId: string; name: string; color: string; pack: string; skcs: string[]; skus: string[]; sizes: string[];
  origins: import('./marketplaceExport').OrganizerRowOrigin[];
}
export interface OrganizerLinkCandidates {
  groupId: string; name: string; photoIds: string[]; state: 'pending_link' | 'linked' | 'needs_review';
  severity: 'error' | 'warning'; message: string; candidates: OrganizerLinkCandidate[];
}
export interface OrganizerLinkConflict { field: string; source: string; target: string; excel: string }
export interface OrganizerLinkPreview {
  group: OrganizerLinkCandidates; variantId: string; productId: string; sourceProductIds: string[];
  previewToken: string; conflicts: OrganizerLinkConflict[]; values: import('./marketplaceExport').OrganizerCommercialSource;
}
export interface OrganizerLinkResult { groupId: string; productId: string; state: 'linked' }
export interface CatalogSourceAlert { itemId: string | null; severity: 'error' | 'warning'; message: string; photoId: string | null; link?: OrganizerLinkCandidates }
export interface CatalogSourceAlerts { alerts: CatalogSourceAlert[] }

export type OrganizerResponse = OrganizerLinkCandidates | OrganizerLinkPreview | OrganizerLinkResult | CatalogSourceAlerts | OrganizerProductWorkflow | OrganizerDraft | { mimeType: 'image/jpeg'; base64: string } | OrganizerConfig | OrganizerRun | OrganizerVariant | OrganizerPhoto | null
  | OrganizerPage<OrganizerClient>
  | OrganizerPage<OrganizerRun | OrganizerVariant | OrganizerPhoto | OrganizerProductRow | OrganizerTab | OrganizerRunFile | OrganizerLedgerItem | OrganizerBaseProduct | OrganizerCommercialVariant | OrganizerPlanItem | OrganizerInterpretation>
  | { run: OrganizerRun; reportUrl: string | null; controlSheetUrl: string | null };
