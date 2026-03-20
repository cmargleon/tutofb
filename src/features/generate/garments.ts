import { v4 as uuidv4 } from 'uuid';
import { UploadedGarmentDraft, SourceType } from './types';

export const handleGarmentFiles = async (
  files: File[],
  existingGarments: UploadedGarmentDraft[]
): Promise<UploadedGarmentDraft[]> => {
  const newGarments: UploadedGarmentDraft[] = [];
  const existingNames = new Set(existingGarments.map(g => g.name));

  // Group files by their directory structure
  const groups = new Map<string, { files: File[], sourceType: SourceType }>();

  for (const file of files) {
    // Skip non-images
    if (!file.type.startsWith('image/')) continue;

    const path = file.webkitRelativePath;
    
    if (!path) {
      // Single file upload
      const name = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
      if (!groups.has(name)) {
        groups.set(name, { files: [], sourceType: 'single' });
      }
      groups.get(name)!.files.push(file);
    } else {
      // Folder upload
      const parts = path.split('/');
      if (parts.length === 2) {
        // Root folder file (e.g., "Folder/image.jpg")
        const name = file.name.replace(/\.[^/.]+$/, "");
        if (!groups.has(name)) {
          groups.set(name, { files: [], sourceType: 'folder-root' });
        }
        groups.get(name)!.files.push(file);
      } else if (parts.length > 2) {
        // Subfolder file (e.g., "Folder/Subfolder/image.jpg")
        const subfolderName = parts[parts.length - 2];
        if (!groups.has(subfolderName)) {
          groups.set(subfolderName, { files: [], sourceType: 'subfolder' });
        }
        groups.get(subfolderName)!.files.push(file);
      }
    }
  }

  for (const [baseName, group] of groups.entries()) {
    let name = baseName;
    let counter = 1;
    while (existingNames.has(name)) {
      name = `${baseName}_${counter}`;
      counter++;
    }
    existingNames.add(name);

    const isMultiAngle = group.files.length > 1;
    let previewUrl = '';

    if (isMultiAngle) {
      // Compose multi-angle image
      previewUrl = await composeMultiAngleImage(group.files);
    } else {
      previewUrl = URL.createObjectURL(group.files[0]);
    }

    newGarments.push({
      id: uuidv4(),
      name,
      sourceType: group.sourceType,
      files: group.files,
      previewUrl,
      isMultiAngle
    });
  }

  return [...existingGarments, ...newGarments];
};

const composeMultiAngleImage = async (files: File[]): Promise<string> => {
  return new Promise((resolve, reject) => {
    const images = files.map(file => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      return img;
    });

    let loaded = 0;
    images.forEach(img => {
      img.onload = () => {
        loaded++;
        if (loaded === images.length) {
          // All images loaded, draw to canvas
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Calculate dimensions
          const totalWidth = images.reduce((sum, img) => sum + img.width, 0);
          const maxHeight = Math.max(...images.map(img => img.height));

          canvas.width = totalWidth;
          canvas.height = maxHeight;

          let currentX = 0;
          for (const img of images) {
            ctx.drawImage(img, currentX, 0);
            currentX += img.width;
          }

          resolve(canvas.toDataURL('image/jpeg', 0.9));
        }
      };
      img.onerror = () => reject(new Error('Failed to load image for composition'));
    });
  });
};

export const revokeGarmentUrls = (garments: UploadedGarmentDraft[]) => {
  garments.forEach(g => URL.revokeObjectURL(g.previewUrl));
};
