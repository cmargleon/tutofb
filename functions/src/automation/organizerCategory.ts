import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationJob, Client, OrganizerCategoryDecision, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { DEFAULT_AUTOMATION_RULES } from '../../../shared/src/automationConfig';
import { getAppFirestore } from '../firebase/appFirestore';
import { classifyGarmentWithGemini } from '../callables/classifyGarmentViewsWithGemini';
import { templateUsable } from '../spreadsheets/marketplaceExportService';
import { loadSharedSheinTemplates } from '../spreadsheets/sharedSheinCatalog';
import type { OrganizerCommercialLink } from '../organizer/commerce';
import { digest } from '../organizer/drive';

type ClassifierInput = Parameters<typeof classifyGarmentWithGemini>[0];
type Analysis = Awaited<ReturnType<typeof classifyGarmentWithGemini>>;

export async function organizerCategory(job: AutomationJob, client: Client, itemId: string) {
  if (!job.organizerCommerce) return null;
  const db = getAppFirestore();
  const jobRef = db.collection('automationJobs').doc(job.id);
  const ref = jobRef.collection('organizerCommerce').doc(itemId);
  const link = (await ref.get()).data() as OrganizerCommercialLink | undefined;
  if (!link) return null;
  const enabled = MARKETPLACES.filter(({ id }) => client.marketplaces?.[id]?.enabled);
  const channel = client.automation?.organizerGeneration?.marketplaceId ?? (enabled.length === 1 ? enabled[0].id : null);
  if (!channel || !enabled.some(({ id }) => id === channel)) return null;
  const snapshot = await db.collection('clients').doc(job.clientId).collection('spreadsheetTemplates')
    .where('exportConfig.marketplaceId', '==', channel).limit(201).get();
  // Clients without their own SHEIN template use the shared official catalogue, exactly like the export does.
  const shared = channel === 'shein' ? await loadSharedSheinTemplates([]) : [];
  const templates = snapshot.size > 200 ? [] : [...snapshot.docs, ...shared].flatMap(doc => {
    const template = { ...doc.data(), id: doc.id } as SpreadsheetTemplate;
    return templateUsable(template, channel) && template.exportConfig!.version > 0 && !template.exportConfig!.supersededByTemplateId
      ? [{ doc, template }] : [];
  });
  const candidates = (await Promise.all(templates.map(async ({ doc, template }) =>
    (await doc.ref.collection('categories').limit(101).get()).docs.flatMap(category => {
      if (!template.categoryIds.includes(category.id) || !template.exportConfig!.mappings[category.id]) return [];
      return [{ id: `${template.id}/${category.id}`, templateId: template.id!, version: template.exportConfig!.version,
        category: { ...category.data(), id: category.id } as SpreadsheetTemplateCategory }];
    })))).flat();
  // A truncated candidate list could produce a wrong automatic assignment.
  const available = candidates.length <= 100 ? candidates : [];
  const categories = available.map(({ id, category }) => ({ ...category, id }));
  const commercialContext = JSON.stringify({
    nombre: link.source.values.name, descripcion: link.source.values.description, categoria: link.source.values.category, incidencia: link.source.issue,
    variantes: link.source.variants.slice(0, 20).map(({ id, values, attributes }) => ({ values, attributes, origen: link.source.origins[id]?.slice(0, 2) })),
  }).slice(0, 6000);
  const persist = (decision: OrganizerCategoryDecision, analysis?: Analysis, key?: string) => db.runTransaction(async tx => {
    const current = (await tx.get(jobRef)).data();
    if (current?.leaseToken !== job.leaseToken || current.status !== 'importing' || current.batchId)
      throw new HttpsError('aborted', 'Reserva de importación no disponible.');
    tx.update(ref, { category: decision });
    if (analysis && key) tx.update(jobRef, { [`analysisCache.${key}`]: analysis });
  });
  const pending = (reason: string) => ({ marketplaceId: channel, templateId: null, categoryId: null, version: null, confidence: null, reason });
  if (!categories.length) await persist(pending(candidates.length > 100 || snapshot.size > 200
    ? 'Hay demasiadas categorías vigentes para asignar una automáticamente.' : 'Falta una plantilla compatible activa con categorías para este canal.'));
  const key = (classificationKey: string) => digest([classificationKey, channel, commercialContext, available.map(c => [c.id, c.version])]);
  return {
    key,
    hasCandidates: categories.length > 0,
    classify: async (input: ClassifierInput, classificationKey: string) => {
      if (!categories.length) return classifyGarmentWithGemini(input);
      const cacheKey = key(classificationKey);
      const analysis = job.analysisCache?.[cacheKey] || await classifyGarmentWithGemini({
        ...input, categories, commercialContext,
        ...(input.automation ? { automation: { ...input.automation, key: `classification:${cacheKey}:${job.retryCount}` } } : {}),
      });
      const candidate = available.find(value => value.id === analysis.matchedCategoryId);
      const confidence = analysis.matchedCategoryConfidence ?? null;
      const reason = analysis.matchedCategoryReasoning || 'Las referencias y el Excel no aportan evidencia suficiente para asignar la categoría.';
      const confirmed = candidate && (confidence ?? 0) >= (job.effectiveRules?.classificationMinConfidence ?? DEFAULT_AUTOMATION_RULES.classificationMinConfidence);
      await persist({
        marketplaceId: channel, templateId: confirmed ? candidate.templateId : null, categoryId: confirmed ? candidate.category.id! : null,
        version: confirmed ? candidate.version : null, confidence, reason,
      }, analysis, cacheKey);
      return analysis;
    },
    recordFailure: () => persist(pending('Gemini no pudo resolver la categoría comercial. Selecciona la plantilla y categoría en Catálogo.')),
  };
}
