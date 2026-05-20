import { v4 as uuidv4 } from 'uuid';
import { GarmentAccessoryType, GarmentBodyArea, GarmentView } from '../../../shared/src/types';
import * as garmentViewMatchingNamespace from '../../../shared/src/utils/garmentViewMatching';
import {
  GarmentOriginalPhotoDraft,
  SourceType,
  UploadedGarmentDraft,
  createInitialGarmentPhotoClassificationState,
  createInitialGarmentUploadState,
} from './types';

const garmentViewMatchingModule =
  ((garmentViewMatchingNamespace as { default?: unknown }).default as typeof import('../../../shared/src/utils/garmentViewMatching'))
  ?? (garmentViewMatchingNamespace as typeof import('../../../shared/src/utils/garmentViewMatching'));

const { getSortedUniqueGarmentViews } =
  garmentViewMatchingModule as typeof import('../../../shared/src/utils/garmentViewMatching');

interface FileLike {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  webkitRelativePath?: string;
}

interface GroupedGarmentInput<TFile extends FileLike> {
  name: string;
  files: TFile[];
  sourceType: SourceType;
}

const TARGET_HEIGHT = 1024;
const GAP = 8;

const isImageFile = <TFile extends FileLike>(file: TFile): boolean => file.type.startsWith('image/');

export const fileFingerprint = <TFile extends FileLike>(file: TFile): string =>
  [
    file.webkitRelativePath || '',
    file.name,
    file.size,
    file.lastModified,
  ].join('::');

const baseName = (value: string): string => value.replace(/\.[^.]+$/, '').trim() || 'prenda';

const uniqueName = (requestedName: string, existingNames: Set<string>): string => {
  const cleaned = requestedName.trim() || 'prenda';
  if (!existingNames.has(cleaned)) {
    existingNames.add(cleaned);
    return cleaned;
  }

  let attempt = 2;
  while (existingNames.has(`${cleaned} (${attempt})`)) {
    attempt += 1;
  }

  const resolved = `${cleaned} (${attempt})`;
  existingNames.add(resolved);
  return resolved;
};

export const groupGarmentFiles = <TFile extends FileLike>(
  files: TFile[],
  currentNames: string[] = [],
  existingFingerprints: string[] = [],
): GroupedGarmentInput<TFile>[] => {
  const dedupeFingerprints = new Set(existingFingerprints);
  const nextNames = new Set(currentNames);

  const incomingImages = files
    .filter(isImageFile)
    .filter((file) => {
      const fingerprint = fileFingerprint(file);
      if (dedupeFingerprints.has(fingerprint)) {
        return false;
      }
      dedupeFingerprints.add(fingerprint);
      return true;
    });

  if (incomingImages.length === 0) {
    return [];
  }

  const singleFiles = incomingImages.filter((file) => !file.webkitRelativePath);
  const grouped: GroupedGarmentInput<TFile>[] = singleFiles.map((file) => ({
    name: uniqueName(baseName(file.name), nextNames),
    files: [file],
    sourceType: 'single',
  }));

  const folderFiles = incomingImages.filter((file) => Boolean(file.webkitRelativePath));
  if (folderFiles.length === 0) {
    return grouped;
  }

  const hasSubfolders = folderFiles.some((file) => (file.webkitRelativePath || '').split('/').length >= 3);

  if (!hasSubfolders) {
    const rootFolderName = baseName((folderFiles[0].webkitRelativePath || '').split('/')[0] || 'prenda');
    grouped.push({
      name: uniqueName(rootFolderName, nextNames),
      files: folderFiles,
      sourceType: 'folder-root',
    });
    return grouped;
  }

  const subfolderGroups = new Map<string, TFile[]>();
  folderFiles.forEach((file) => {
    const parts = (file.webkitRelativePath || '').split('/');
    if (parts.length >= 3) {
      const key = baseName(parts[1] || parts[parts.length - 2] || file.name);
      if (!subfolderGroups.has(key)) {
        subfolderGroups.set(key, []);
      }
      subfolderGroups.get(key)!.push(file);
      return;
    }

    grouped.push({
      name: uniqueName(baseName(file.name), nextNames),
      files: [file],
      sourceType: 'folder-root',
    });
  });

  Array.from(subfolderGroups.entries())
    .sort(([left], [right]) => left.localeCompare(right, 'es'))
    .forEach(([name, groupFiles]) => {
      grouped.push({
        name: uniqueName(name, nextNames),
        files: groupFiles,
        sourceType: 'subfolder',
      });
    });

  return grouped;
};

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`No se pudo leer la imagen ${file.name}.`));
    };

    image.src = url;
  });

export const calculateCompositeLayout = (
  dimensions: Array<{ width: number; height: number }>,
): { scaledWidths: number[]; totalWidth: number; targetHeight: number; gap: number } => {
  const scaledWidths = dimensions.map((image) => Math.round((image.width / image.height) * TARGET_HEIGHT));
  return {
    scaledWidths,
    totalWidth: scaledWidths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, dimensions.length - 1),
    targetHeight: TARGET_HEIGHT,
    gap: GAP,
  };
};

export const composeMultiAngleImage = async (files: File[]): Promise<File> => {
  if (files.length === 1) {
    return files[0];
  }

  const images = await Promise.all(files.map(loadImage));
  const layout = calculateCompositeLayout(
    images.map((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  );

  const canvas = document.createElement('canvas');
  canvas.width = layout.totalWidth;
  canvas.height = layout.targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas no disponible en este navegador.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, layout.totalWidth, layout.targetHeight);

  let offsetX = 0;
  images.forEach((image, index) => {
    context.drawImage(image, offsetX, 0, layout.scaledWidths[index], layout.targetHeight);
    offsetX += layout.scaledWidths[index] + layout.gap;
  });

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo generar la composición multiángulo.'));
          return;
        }

        resolve(new File([blob], `composite-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  });
};

export const handleGarmentFiles = async (
  files: File[],
  existingGarments: UploadedGarmentDraft[],
): Promise<UploadedGarmentDraft[]> => {
  const grouped = groupGarmentFiles(
    files,
    existingGarments.map((garment) => garment.name),
    existingGarments.flatMap((garment) => garment.files.map(fileFingerprint)),
  );

  if (grouped.length === 0) {
    return existingGarments;
  }

  const preparedGarments = await Promise.all(
    grouped.map(async (group) => {
      const originalPhotos: GarmentOriginalPhotoDraft[] = (group.files as File[]).map((file, index) => {
        const isSinglePhoto = group.files.length === 1;
        return {
          id: uuidv4(),
          file,
          fileName: file.name,
          sourceIndex: index,
          previewUrl: URL.createObjectURL(file),
          upload: createInitialGarmentUploadState(),
          classification: isSinglePhoto
            ? createInitialGarmentPhotoClassificationState({
                status: 'classified',
                view: 'front',
                classifiedBy: 'assumed_single_front',
                reasoning: 'Se asumió frente porque la prenda solo tiene una foto.',
              })
            : createInitialGarmentPhotoClassificationState(),
        };
      });
      const previewUrl = originalPhotos[0]?.previewUrl || '';

      return {
        id: uuidv4(),
        name: group.name,
        sourceType: group.sourceType,
        files: group.files as File[],
        previewUrl,
        isMultiAngle: group.files.length > 1,
        originalFileNames: group.files.map((file) => file.name),
        originalPhotos,
        upload: createInitialGarmentUploadState(),
      } satisfies UploadedGarmentDraft;
    }),
  );

  return [...existingGarments, ...preparedGarments];
};

export const revokeGarmentUrls = (garments: UploadedGarmentDraft[]) => {
  garments.forEach((garment) => {
    URL.revokeObjectURL(garment.previewUrl);
    garment.originalPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  });
};

export const getGarmentAvailableViews = (garment: UploadedGarmentDraft) =>
  getSortedUniqueGarmentViews(
    garment.originalPhotos
      .map((photo) => photo.classification.view)
      .filter((view): view is GarmentView => Boolean(view)),
  );

export const getGarmentBodyArea = (garment: UploadedGarmentDraft) => garment.garmentBodyArea ?? null;
export const getGarmentAccessoryType = (garment: UploadedGarmentDraft) => garment.garmentAccessoryType ?? null;

export const getGarmentAccessoryInferenceTexts = (
  garment: UploadedGarmentDraft,
  extraTexts: Array<string | null | undefined> = [],
): Array<string | null | undefined> => [
  garment.name,
  ...garment.originalFileNames,
  garment.matchedCategoryLabel,
  ...extraTexts,
];

const normalizeAccessoryText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const inferGarmentAccessoryTypeFromText = (
  values: Array<string | null | undefined>,
): GarmentAccessoryType | null => {
  const normalized = values
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeAccessoryText)
    .join(' ');

  if (/\b(mochila|mochilas|backpack|backpacks|morral|morrales)\b/.test(normalized)) return 'backpack';
  if (/\b(crossbody|bandolera|bandoleras|cruzada|cruzadas)\b/.test(normalized)) return 'crossbody_bag';
  if (/\b(tote|totes)\b/.test(normalized)) return 'tote_bag';
  if (/\b(duffel|duffels|maleta|maletas|bolsa de gimnasio|bolsas de gimnasio)\b/.test(normalized)) return 'duffel_bag';
  if (/\b(handbag|handbags|bolso de mano|bolsos de mano|cartera|carteras)\b/.test(normalized)) return 'handbag';
  if (/\b(shoulder bag|shoulder bags|bolsa de hombro|bolsas de hombro|bolso de hombro|bolsos de hombro)\b/.test(normalized)) return 'shoulder_bag';

  return null;
};

export const getEffectiveGarmentAccessoryType = (
  garment: UploadedGarmentDraft,
  extraTexts: Array<string | null | undefined> = [],
): GarmentAccessoryType | null =>
  garment.garmentAccessoryType
  || inferGarmentAccessoryTypeFromText(getGarmentAccessoryInferenceTexts(garment, extraTexts));

export const getEffectiveGarmentBodyArea = (
  garment: UploadedGarmentDraft,
  extraTexts: Array<string | null | undefined> = [],
): GarmentBodyArea | null =>
  getEffectiveGarmentAccessoryType(garment, extraTexts) ? 'carry_accessory' : garment.garmentBodyArea ?? null;

export const applyGarmentAccessoryInference = (
  garment: UploadedGarmentDraft,
  extraTexts: Array<string | null | undefined> = [],
): UploadedGarmentDraft => {
  const garmentAccessoryType = getEffectiveGarmentAccessoryType(garment, extraTexts);
  if (!garmentAccessoryType) {
    return garment;
  }

  return {
    ...garment,
    garmentBodyArea: 'carry_accessory',
    garmentAccessoryType,
  };
};

export const buildGarmentSuggestionSignature = (
  selectedModelId: string | null,
  garments: UploadedGarmentDraft[],
  context: {
    outputMode?: string | null;
    selectedSpreadsheetCategoryId?: string | null;
    selectedSpreadsheetCategoryLabel?: string | null;
  } = {},
): string =>
  JSON.stringify({
    selectedModelId,
    outputMode: context.outputMode ?? null,
    selectedSpreadsheetCategoryId: context.selectedSpreadsheetCategoryId ?? null,
    selectedSpreadsheetCategoryLabel: context.selectedSpreadsheetCategoryLabel ?? null,
    garments: garments.map((garment) => ({
      id: garment.id,
      name: garment.name,
      garmentBodyArea: garment.garmentBodyArea ?? null,
      garmentAccessoryType: garment.garmentAccessoryType ?? null,
      matchedCategoryLabel: garment.matchedCategoryLabel ?? null,
      photos: garment.originalPhotos.map((photo) => ({
        id: photo.id,
        fingerprint: fileFingerprint(photo.file),
      })),
    })),
  });
