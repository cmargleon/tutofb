import { createSign } from 'node:crypto';
import {
  getGoogleClientEmail,
  getGoogleDriveFolderId,
  getGoogleWorkspaceUserEmail,
  GOOGLE_PRIVATE_KEY,
} from '../config/runtime';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GOOGLE_SHEETS_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';

interface GoogleDriveConfig {
  clientEmail: string;
  privateKey: string;
  folderId: string;
  workspaceUserEmail: string | null;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface DriveFileResponse {
  id?: string;
  webViewLink?: string;
}

interface CachedAccessToken {
  cacheKey: string;
  token: string;
  expiresAtMs: number;
}

let cachedAccessToken: CachedAccessToken | null = null;

const requireEnvValue = (value: string | undefined, name: string): string => {
  const normalized = value?.trim() || '';
  if (!normalized) {
    throw new Error(`${name} no está configurada.`);
  }

  return normalized;
};

const normalizePrivateKey = (value: string): string =>
  value
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n');

const getGoogleDriveConfig = (): GoogleDriveConfig => ({
  clientEmail: requireEnvValue(getGoogleClientEmail() || process.env.GOOGLE_CLIENT_EMAIL, 'GOOGLE_CLIENT_EMAIL'),
  privateKey: normalizePrivateKey(
    requireEnvValue(GOOGLE_PRIVATE_KEY.value() || process.env.GOOGLE_PRIVATE_KEY, 'GOOGLE_PRIVATE_KEY'),
  ),
  folderId: requireEnvValue(getGoogleDriveFolderId() || process.env.GOOGLE_DRIVE_FOLDER_ID, 'GOOGLE_DRIVE_FOLDER_ID'),
  workspaceUserEmail: (getGoogleWorkspaceUserEmail() || process.env.GOOGLE_WORKSPACE_USER_EMAIL || '').trim() || null,
});

const toBase64Url = (input: string | Buffer): string =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const buildServiceAccountJwt = (config: GoogleDriveConfig): string => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const claimSet: Record<string, string | number> = {
    iss: config.clientEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  if (config.workspaceUserEmail) {
    claimSet.sub = config.workspaceUserEmail;
  }

  const unsignedJwt = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(claimSet))}`;
  const signature = createSign('RSA-SHA256')
    .update(unsignedJwt)
    .sign(config.privateKey);

  return `${unsignedJwt}.${toBase64Url(signature)}`;
};

const parseGoogleError = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return `Google API respondió con status ${response.status}.`;
  }

  try {
    const payload = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
    if (typeof payload.error === 'object' && payload.error?.message) {
      return payload.error.message;
    }
    if (typeof payload.error === 'string') {
      return payload.error_description ? `${payload.error}: ${payload.error_description}` : payload.error;
    }
  } catch {
    // Conservamos el texto original si Google no devuelve JSON.
  }

  return text;
};

const getAccessToken = async (config: GoogleDriveConfig): Promise<string> => {
  const cacheKey = `${config.clientEmail}:${config.workspaceUserEmail || ''}`;
  if (cachedAccessToken?.cacheKey === cacheKey && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const assertion = buildServiceAccountJwt(config);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const payload = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    const message = payload.error_description || payload.error || `Google OAuth respondió con status ${response.status}.`;
    throw new Error(message);
  }

  cachedAccessToken = {
    cacheKey,
    token: payload.access_token,
    expiresAtMs: Date.now() + Math.max(0, (payload.expires_in || 3600) - 120) * 1000,
  };

  return payload.access_token;
};

const buildMultipartBody = (metadata: Record<string, unknown>, media: Buffer): { body: Buffer; contentType: string } => {
  const boundary = `batch_spreadsheet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadataPart = Buffer.from(
    [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${XLSX_MIME_TYPE}`,
      '',
      '',
    ].join('\r\n'),
    'utf8',
  );
  const closingPart = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    body: Buffer.concat([metadataPart, media, closingPart]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
};

const buildSheetUrl = (sheetId: string): string =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit`;

const parseDriveFileResponse = async (response: Response): Promise<{ sheetId: string; sheetUrl: string }> => {
  const payload = (await response.json()) as DriveFileResponse;
  const sheetId = payload.id?.trim();
  if (!sheetId) {
    throw new Error('Google Drive no devolvió el ID del Google Sheet.');
  }

  return {
    sheetId,
    sheetUrl: payload.webViewLink || buildSheetUrl(sheetId),
  };
};

export const createGoogleSheetFromXlsx = async ({
  workbookBuffer,
  sheetName,
}: {
  workbookBuffer: Buffer;
  sheetName: string;
}): Promise<{ sheetId: string; sheetUrl: string }> => {
  const config = getGoogleDriveConfig();
  const token = await getAccessToken(config);
  const { body, contentType } = buildMultipartBody(
    {
      name: sheetName,
      mimeType: GOOGLE_SHEETS_MIME_TYPE,
      parents: [config.folderId],
    },
    workbookBuffer,
  );
  const response = await fetch(
    `${DRIVE_FILES_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: body as unknown as BodyInit,
    },
  );

  if (!response.ok) {
    throw new Error(await parseGoogleError(response));
  }

  return parseDriveFileResponse(response);
};

export const updateGoogleSheetFromXlsx = async ({
  sheetId,
  workbookBuffer,
  sheetName,
}: {
  sheetId: string;
  workbookBuffer: Buffer;
  sheetName: string;
}): Promise<{ sheetId: string; sheetUrl: string }> => {
  const config = getGoogleDriveConfig();
  const token = await getAccessToken(config);
  const { body, contentType } = buildMultipartBody({ name: sheetName }, workbookBuffer);
  const response = await fetch(
    `${DRIVE_FILES_UPLOAD_URL}/${encodeURIComponent(sheetId)}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: body as unknown as BodyInit,
    },
  );

  if (!response.ok) {
    throw new Error(await parseGoogleError(response));
  }

  return parseDriveFileResponse(response);
};

export const shareGoogleSheetWithEditor = async ({
  sheetId,
  editorEmail,
}: {
  sheetId: string;
  editorEmail: string;
}): Promise<void> => {
  const config = getGoogleDriveConfig();
  const normalizedEditorEmail = editorEmail.trim().toLowerCase();
  const ownerEmails = [config.clientEmail, config.workspaceUserEmail]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  if (!normalizedEditorEmail || ownerEmails.includes(normalizedEditorEmail)) {
    return;
  }

  const token = await getAccessToken(config);
  const response = await fetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(sheetId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'writer',
        type: 'user',
        emailAddress: normalizedEditorEmail,
      }),
    },
  );

  if (!response.ok) {
    const message = await parseGoogleError(response);
    if (response.status === 400 && message.toLowerCase().includes('permission already exists')) {
      return;
    }
    throw new Error(message);
  }
};
