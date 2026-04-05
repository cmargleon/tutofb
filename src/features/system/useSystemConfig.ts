import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { SystemConfig } from '../../../shared/src/types';

const DEFAULT_CONFIG: SystemConfig = {
  jobMaxRetries: 3,
  jobRetryDelayMs: 300000,
  batchMaxJobs: 100,
  geminiImageReviewModel: 'gemini-3.1-flash-lite-preview',
  disabledProviders: [],
  systemPromptOverride: null,
  systemPromptFullOutfit: null,
  systemPromptTopOnly: null,
  systemPromptBottomOnly: null,
};

export const useSystemConfig = () => {
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, 'system_config', 'main');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Partial<SystemConfig>;
        setConfig({
          jobMaxRetries: typeof data.jobMaxRetries === 'number' ? data.jobMaxRetries : DEFAULT_CONFIG.jobMaxRetries,
          jobRetryDelayMs: typeof data.jobRetryDelayMs === 'number' ? data.jobRetryDelayMs : DEFAULT_CONFIG.jobRetryDelayMs,
          batchMaxJobs: typeof data.batchMaxJobs === 'number' ? data.batchMaxJobs : DEFAULT_CONFIG.batchMaxJobs,
          geminiImageReviewModel: typeof data.geminiImageReviewModel === 'string' && data.geminiImageReviewModel.trim() ? data.geminiImageReviewModel.trim() : DEFAULT_CONFIG.geminiImageReviewModel,
          disabledProviders: Array.isArray(data.disabledProviders) ? data.disabledProviders : [],
          systemPromptOverride: typeof data.systemPromptOverride === 'string' && data.systemPromptOverride.trim() ? data.systemPromptOverride.trim() : null,
          systemPromptFullOutfit:
            typeof data.systemPromptFullOutfit === 'string' && data.systemPromptFullOutfit.trim()
              ? data.systemPromptFullOutfit.trim()
              : DEFAULT_CONFIG.systemPromptFullOutfit,
          systemPromptTopOnly:
            typeof data.systemPromptTopOnly === 'string' && data.systemPromptTopOnly.trim()
              ? data.systemPromptTopOnly.trim()
              : DEFAULT_CONFIG.systemPromptTopOnly,
          systemPromptBottomOnly:
            typeof data.systemPromptBottomOnly === 'string' && data.systemPromptBottomOnly.trim()
              ? data.systemPromptBottomOnly.trim()
              : DEFAULT_CONFIG.systemPromptBottomOnly,
        });
      }
      setLoading(false);
    }, () => { setLoading(false); });
    return () => unsub();
  }, []);

  return { config, loading };
};
