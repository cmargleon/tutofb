import { Job } from '../../../shared/src/types';

export interface GarmentSlide {
  garmentId: string;
  garmentName: string;
  garmentFilePath: string;
  jobs: Job[];
}

export const buildGarmentSlides = (jobs: Job[]): GarmentSlide[] => {
  const slidesMap = new Map<string, GarmentSlide>();

  jobs.forEach(job => {
    // Use garmentId as key, fallback to garmentFilePath + garmentName if garmentId is missing
    const key = job.garmentId || `${job.garmentFilePath}-${job.garmentName}`;
    
    if (!slidesMap.has(key)) {
      slidesMap.set(key, {
        garmentId: key,
        garmentName: job.garmentName,
        garmentFilePath: job.garmentFilePath,
        jobs: []
      });
    }
    
    slidesMap.get(key)!.jobs.push(job);
  });

  // Convert map to array and sort jobs within each slide
  const slides = Array.from(slidesMap.values());
  
  slides.forEach(slide => {
    slide.jobs.sort((a, b) => {
      // Sort by poseImageId if available, otherwise by createdAt
      if (a.poseImageId && b.poseImageId) {
        return a.poseImageId.localeCompare(b.poseImageId);
      }
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt).getTime();
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime();
      return aTime - bTime;
    });
  });

  return slides;
};
