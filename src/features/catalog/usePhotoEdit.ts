import { useState } from 'react';
import type { Provider } from '../../../shared/src/types';
import { editJobPhoto } from './firebase';
import { useToast } from '../feedback/FeedbackProvider';

export const usePhotoEdit = (jobId: string, sourceOutputId: string, onQueued: () => void, provider?: Provider) => {
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const submit = async () => {
    if (submitting || !instructions.trim()) return;
    setSubmitting(true);
    try {
      await editJobPhoto({ jobId, sourceOutputId, instructions: instructions.trim(), ...(provider ? { provider } : {}) });
      toast({ tone: 'success', title: 'Ajuste encolado', description: 'Se guardará como una nueva versión de este trabajo.' });
      onQueued();
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudo ajustar la foto', description: error instanceof Error ? error.message : 'Inténtalo nuevamente.' });
    } finally {
      setSubmitting(false);
    }
  };
  return { instructions, setInstructions, submitting, submit };
};
