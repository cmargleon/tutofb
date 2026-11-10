export interface ConnectorFile {
  id: string;
  mimeType?: string;
  size?: string;
}

export interface ConnectorPlan<F extends ConnectorFile = ConnectorFile> {
  files: F[];
  copies: Array<{ fileId: string; name: string; directories: string[] }>;
}

export interface ConnectorEntry {
  id: string;
  name: string;
  folder?: boolean;
  mimeType?: string;
  size?: string;
  url?: string;
}

export interface ConnectorReceipt {
  sourceFileId: string;
  id: string;
  name: string;
  parentId: string;
  url?: string;
  verified: boolean;
}

export interface ConnectorJournal {
  folders: Array<[string, string]>;
  receipts: ConnectorReceipt[];
  errors: string[];
}

export interface ConnectorTransport<F extends ConnectorFile = ConnectorFile> {
  list(parentId: string): Promise<ConnectorEntry[]>;
  createFolder(parentId: string, name: string): Promise<{ id: string }>;
  copy(parentId: string, name: string, file: F): Promise<{ id: string; url?: string }>;
  checkpoint(journal: ConnectorJournal): Promise<void>;
}

export function copyThroughConnector<F extends ConnectorFile>(
  plan: ConnectorPlan<F>,
  rootId: string,
  transport: ConnectorTransport<F>,
  journal: Partial<ConnectorJournal>,
  width?: number,
): Promise<ConnectorJournal>;
