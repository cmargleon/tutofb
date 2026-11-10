import type {
  AutomationItemState,
  AutomationJobReceipt,
  AutomationPlanSummary,
  AutomationStatus,
} from '../shared/src/types';

export interface PollingPolicy {
  readonly initialIntervalSeconds: number;
  readonly initialWindowSeconds: number;
  readonly subsequentIntervalSeconds: number;
  readonly timeoutSeconds: number;
}

/** Minimum job shape the polling helpers need (createdAt is an ISO string). */
export interface PollableJob {
  jobId: string;
  status: string;
  createdAt: string;
}

export interface PollingFields {
  createdAt: string;
  pollingDeadlineAt: string;
  pollAfterSeconds: number;
  pollingTimedOut: boolean;
  pollingPolicy: PollingPolicy;
}

/** Compact job returned by GET /jobs/:id (fields the client relies on). */
export interface AutomationJobStatus extends PollingFields {
  jobId: string;
  status: AutomationStatus;
  items: AutomationItemState[];
  error: { code: string; message: string } | null;
  progress: { total: number; completed: number; failed: number };
}

export type AutomationJobStart = AutomationJobReceipt & PollingFields;

export interface PollingPlan {
  done: boolean;
  timedOut: boolean;
  delaySeconds: number;
}

export const POLLING_POLICY: PollingPolicy;
export function getPollingPlan(job: Pick<PollableJob, 'status' | 'createdAt'>, now?: number): PollingPlan;

export class AutomationPollingTimeout extends Error {
  constructor(job: Pick<PollableJob, 'jobId' | 'status'>);
  jobId: string;
  lastStatus: string;
}

export interface ManglarAutomationClientOptions {
  clientId?: string;
  getClientSecret: () => string | Promise<string>;
  baseUrl?: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  allowLocalEmulator?: boolean;
}

export interface WaitForJobOptions {
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class ManglarAutomationClient {
  constructor(options: ManglarAutomationClientOptions);
  readonly baseUrl: string;
  readonly clientId: string;
  capabilities(): Promise<unknown>;
  preparePlan(payload: unknown): Promise<AutomationPlanSummary>;
  getPlan(planId: string): Promise<AutomationPlanSummary>;
  executePlan(planId: string): Promise<AutomationJobStart>;
  resumeJob(jobId: string, budgetUsd?: number): Promise<unknown>;
  downloadResults(jobId: string): Promise<ArrayBuffer>;
  listDriveFiles(clientId: string, folderId: string): Promise<unknown>;
  upload(bytes: BodyInit, contentType?: string): Promise<{ storagePath: string }>;
  createJob(payload: unknown): Promise<AutomationJobStart>;
  waitForJob<J extends PollableJob>(initialJob: J, options?: WaitForJobOptions): Promise<J | AutomationJobStatus>;
  getJob(jobId: string, options?: { signal?: AbortSignal }): Promise<AutomationJobStatus>;
}
