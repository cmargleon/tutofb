export type Role = 'admin' | 'operador' | 'revisor';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: any; // Firestore Timestamp
  updatedAt: any;
}

export interface Client {
  id?: string;
  name: string;
  createdAt: any;
  updatedAt: any;
  batchCount: number;
  lastBatchCreatedAt: any | null;
  createdByUid: string;
}

export interface Pose {
  id: string;
  storagePath: string;
  fileName: string;
  createdAt: any;
}

export interface Model {
  id?: string;
  clientId: string;
  clientNameSnapshot: string;
  name: string;
  poses: Pose[];
  poseCount: number;
  createdAt: any;
  updatedAt: any;
  createdByUid: string;
}

export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed';

export interface Batch {
  id?: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId: string;
  modelNameSnapshot: string;
  poseIds: string[];
  garmentCount: number;
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  status: BatchStatus;
  latestJobCreatedAt: any | null;
  createdAt: any;
  updatedAt: any;
  createdByUid: string;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type Provider = 'fal-seedream' | 'fal-banana-pro' | 'openai-gpt-image-1.5';

export interface JobOutput {
  id: string;
  provider: string;
  prompt: string;
  resultImagePath: string;
  createdAt: any;
}

export interface Job {
  id?: string;
  batchId: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId: string;
  modelNameSnapshot: string;
  poseImageId: string;
  poseImagePath: string;
  garmentId: string;
  garmentName: string;
  garmentFilePath: string;
  garmentIsMultiAngle: boolean;
  aspectRatio: string;
  provider: Provider;
  promptBase: string;
  finalPrompt: string;
  backgroundConfig: string;
  status: JobStatus;
  queuePriority: number;
  retryCount: number;
  startedAt: any | null;
  completedAt: any | null;
  currentOutputId: string | null;
  currentOutput: JobOutput | null;
  createdAt: any;
  updatedAt: any;
  createdByUid: string;
  lastError: string | null;
}

export interface JobLog {
  id?: string;
  type: 'provider_response' | 'error' | 'system';
  payload: any;
  createdAt: any;
}

export interface AnalyticsSummary {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  successRate: number;
  avgDurationSeconds: number;
  totalCostUsd: number;
  projectedMonthlyCostUsd: number;
  updatedAt: any;
}

export interface AnalyticsDailyVolume {
  date: string; // yyyy-mm-dd
  completed: number;
  failed: number;
  costUsd: number;
  updatedAt: any;
}

export interface AnalyticsProviderStats {
  provider: Provider;
  completed: number;
  failed: number;
  avgDurationSeconds: number;
  costPerImageUsd: number;
  totalCostUsd: number;
  updatedAt: any;
}

export interface AnalyticsClientStats {
  clientId: string;
  clientNameSnapshot: string;
  completed: number;
  totalCostUsd: number;
  updatedAt: any;
}

export interface AnalyticsData {
  summary: AnalyticsSummary | null;
  dailyVolume: AnalyticsDailyVolume[];
  byProvider: AnalyticsProviderStats[];
  topClients: AnalyticsClientStats[];
}
