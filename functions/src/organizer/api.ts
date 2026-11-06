import { FieldPath, Filter } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import sharp from 'sharp';
import { ORGANIZER_DEFAULT_BUDGET_USD, ORGANIZER_DEFAULT_MODEL, ORGANIZER_DIRECTORIES,
  type OrganizerInterpretation, type OrganizerPlanItem, type OrganizerBaseProduct, type OrganizerCommercialVariant, type OrganizerDraft, type OrganizerLedgerItem, type OrganizerRunFile, type OrganizerPhoto, type OrganizerProductRow, type OrganizerRequest, type OrganizerResponse,
  type OrganizerRun, type OrganizerSettings, type OrganizerTab, type OrganizerVariant, type Role } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { GOOGLE_PRIVATE_KEY } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertClientAccess, delegatedStamp, loadManglarUser } from '../manglar/access';
import type { DelegatedCaller } from '../manglar/context';
import { OrganizerDrive, digest, versionOf, type DriveEntry } from './drive';
import { checkedId, clientRef, configs, defaultConfig, enqueue, listPage, publicConfig, publicRun, requiresCopy, runRef, type StoredConfig, type StoredRun } from './store';
import { MODEL_PRICES } from './vision';
import { photoDecisionKey } from './planning';

type Actor = { uid: string; role: Role; delegated?: DelegatedCaller };
const actions = ['clients', 'config', 'configure', 'start', 'run', 'pause', 'resume', 'cancel', 'report',
  'runs', 'products', 'photos', 'conflicts', 'tabs', 'baseProducts', 'commercial', 'files', 'ledger', 'plan', 'interpretations', 'provenance', 'correct', 'references', 'thumbnail', 'draft'];
const writeActions = new Set(['configure', 'start', 'pause', 'resume', 'cancel', 'correct', 'references', 'draft']);
const paidModes = ['classify', 'sync'];
const allowed = (actor: Actor, config?: StoredConfig) =>
  (!actor.delegated || !config || actor.delegated.allowedClientIds === null || actor.delegated.allowedClientIds.includes(config.clientId)) &&
  (actor.role === 'admin' || Boolean(config?.operatorUids.includes(actor.uid)));
const text = (input: unknown, fallback: string, max = 120) => {
  const value = input === undefined ? fallback : typeof input === 'string' ? input.trim() : '';
  if (!value || value.length > max || /[\u0000-\u001f]/.test(value)) throw new HttpsError('invalid-argument', 'Texto de configuración inválido.');
  return value;
};
const folderName = (input: unknown, fallback: string) => {
  const name = text(input, fallback);
  if (/[\\/]/.test(name)) throw new HttpsError('invalid-argument', 'Usa un nombre de carpeta sin separadores.');
  return name;
};
const number = (input: unknown, fallback: number, min: number, max: number, integer = false) => {
  const value = input ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value))
    throw new HttpsError('invalid-argument', 'Valor numérico de configuración fuera de rango.');
  return value;
};
const bool = (input: unknown, fallback = false) => {
  if (input !== undefined && typeof input !== 'boolean') throw new HttpsError('invalid-argument', 'Se esperaba un valor booleano.');
  return typeof input === 'boolean' ? input : fallback;
};
const driveId = (input: unknown) => {
  if (typeof input !== 'string') return checkedId(input);
  return checkedId(input.trim().match(/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)(?:\?[^#]*)?$/)?.[1] || input.trim());
};
const validateSettings = (input: OrganizerSettings, name: string): OrganizerSettings => {
  if (!input || typeof input !== 'object' || !Array.isArray(input.sourceIds) || input.sourceIds.length > 20)
    throw new HttpsError('invalid-argument', 'Selecciona hasta 20 carpetas de origen.');
  const sourceIds = [...new Set(input.sourceIds.map(driveId))].sort();
  const enabled = bool(input.enabled);
  if (enabled && !sourceIds.length) throw new HttpsError('invalid-argument', 'Selecciona al menos un origen para activar la vigilancia.');
  const operatorUids = input.operatorUids ?? [];
  if (!Array.isArray(operatorUids) || operatorUids.length > 100) throw new HttpsError('invalid-argument', 'Lista de operadores inválida.');
  const model = text(input.model, ORGANIZER_DEFAULT_MODEL);
  const escalationModel = input.escalationModel ? text(input.escalationModel, '') : null;
  if (!Object.hasOwn(MODEL_PRICES, model) || escalationModel && !Object.hasOwn(MODEL_PRICES, escalationModel))
    throw new HttpsError('invalid-argument', 'Modelo Gemini sin tarifa configurada.');
  const directories = Object.fromEntries(Object.entries(ORGANIZER_DIRECTORIES).map(([key, value]) =>
    [key, folderName(input.directories?.[key as keyof typeof ORGANIZER_DIRECTORIES], value)])) as typeof ORGANIZER_DIRECTORIES;
  if (new Set(Object.values(directories)).size !== Object.keys(directories).length) throw new HttpsError('invalid-argument', 'Las carpetas de organización deben tener nombres distintos.');
  return { sourceIds, parentId: driveId(input.parentId), folderName: folderName(input.folderName, `${name} - ORGANIZADO POR MANGLAR`),
    enabled, debounceMinutes: number(input.debounceMinutes, 10, 2, 1440, true),
    budgetUsd: Math.round(number(input.budgetUsd, ORGANIZER_DEFAULT_BUDGET_USD, 0.11, 40) * 100) / 100, model, escalationModel,
    minimumConfidence: number(input.minimumConfidence, 0.75, 0.55, 0.99), controlSheet: bool(input.controlSheet),
    allowInheritedAccess: bool(input.allowInheritedAccess), directories, operatorUids: [...new Set(operatorUids.map(checkedId))], maxCalls: number(input.maxCalls, 300, 1, 1000, true) };
};
const currentConfig = async (clientId: string) => (await clientRef(clientId).get()).data() as StoredConfig | undefined;
const assertSourceFolders = (requested: string[], authorized: string[], existing: string[] = []) => {
  if (requested.some(id => !authorized.includes(id) && !existing.includes(id))) {
    throw new HttpsError('permission-denied', 'Autoriza las carpetas de origen en la ficha del cliente antes de seleccionarlas.');
  }
};

export async function executeOrganizer(request: OrganizerRequest, actor: Actor): Promise<OrganizerResponse> {
  if (!request || typeof request !== 'object' || !actions.includes(request.action)) throw new HttpsError('invalid-argument', 'Acción inválida.');
  if (actor.delegated && (!actor.delegated.scopes.includes('jobs:read') ||
    (writeActions.has(request.action) && !actor.delegated.scopes.includes('jobs:create')))) throw new HttpsError('permission-denied', 'Alcance de Manglar insuficiente.');
  if (request.action === 'clients') {
    const collection = getAppFirestore().collection('clients');
    const configured = new Map((await configs().get()).docs.map(doc => [doc.id, doc.data() as StoredConfig]));
    const ordered = collection.orderBy(FieldPath.documentId());
    const page = await (request.cursor ? ordered.startAfter(checkedId(request.cursor)) : ordered).limit(51).get();
    const docs = page.docs.slice(0, 50);
    const items = docs.filter(doc => doc.data().status !== 'archived' && allowed(actor, configured.get(doc.id)) &&
      (!actor.delegated || actor.delegated.allowedClientIds === null || actor.delegated.allowedClientIds.includes(doc.id)))
      .map(doc => ({ id: doc.id, name: String(doc.data().name || doc.id), configured: configured.has(doc.id),
        ...(actor.role === 'admin' ? { driveFolderIds: doc.data().automation?.driveFolderIds ?? [] } : {}) }));
    return { items, next: page.size > 50 ? docs.at(-1)!.id : null };
  }
  const clientId = actor.delegated ? assertClientAccess(actor.delegated, request.clientId) : checkedId(request.clientId);
  const client = await getAppFirestore().collection('clients').doc(clientId).get();
  if (!client.exists || client.data()?.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
  const root = clientRef(clientId);
  const config = await currentConfig(clientId);
  if (!allowed(actor, config)) throw new HttpsError('permission-denied', 'Cliente fuera de los permisos del organizador.');
  if (request.action === 'configure') {
    if (actor.role !== 'admin') throw new HttpsError('permission-denied', 'La configuración requiere rol administrador.');
    const clientName = String(client.data()?.name || clientId);
    const settings = validateSettings(request.settings, clientName);
    const limitedConnection = actor.delegated && actor.delegated.allowedClientIds !== null;
    assertSourceFolders(settings.sourceIds, client.data()?.automation?.driveFolderIds ?? [], limitedConnection ? [] : config?.sourceIds);
    const drive = new OrganizerDrive();
    await drive.zone(settings.sourceIds, settings.parentId, settings.allowInheritedAccess);
    const [parentChain, ...chains] = await Promise.all([settings.parentId, ...settings.sourceIds].map(id => drive.lineage(id)));
    const parentAncestors = new Set(parentChain.map(item => item.id));
    const sourceAncestors = new Set(chains.flatMap(chain => chain.map(item => item.id)));
    const otherConfigs = (await configs().get()).docs.filter(doc => doc.id !== clientId);
    for (const doc of otherConfigs) {
      const other = doc.data() as StoredConfig;
      if ((await drive.lineage(other.parentId)).some(item => settings.sourceIds.includes(item.id)))
        throw new HttpsError('failed-precondition', 'Un destino de otro cliente quedaría dentro de estos orígenes.');
      for (const source of other.sourceIds) {
        if (parentAncestors.has(source) || sourceAncestors.has(source) || (await drive.lineage(source)).some(item => settings.sourceIds.includes(item.id)))
          throw new HttpsError('failed-precondition', 'Una carpeta de origen se superpone con la de otro cliente.');
      }
    }
    return getAppFirestore().runTransaction(async tx => {
      const [snapshot, currentConfigs, currentClient] = await Promise.all([tx.get(root), tx.get(configs()), tx.get(client.ref)]);
      if (digest(currentConfigs.docs.filter(doc => doc.id !== clientId).map(doc => [doc.id, doc.data().sourceIds, doc.data().parentId])) !==
          digest(otherConfigs.map(doc => [doc.id, doc.data().sourceIds, doc.data().parentId]))) throw new HttpsError('aborted', 'La configuración de otro cliente cambió. Reintenta.');
      const previous = snapshot.data() as StoredConfig | undefined;
      if (!currentClient.exists || currentClient.data()?.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
      assertSourceFolders(settings.sourceIds, currentClient.data()?.automation?.driveFolderIds ?? [], limitedConnection ? [] : previous?.sourceIds);
      if (previous?.activeRunId) throw new HttpsError('failed-precondition', 'Termina o cancela la ejecución activa para cambiar la configuración.');
      if (previous?.destinationId && (previous.parentId !== settings.parentId || previous.folderName !== settings.folderName))
        throw new HttpsError('failed-precondition', 'La carpeta de destino administrada ya existe. Conserva su ubicación y nombre.');
      const updated: StoredConfig = { ...(previous || defaultConfig(clientId, clientName, settings)), ...settings, clientName,
        generationActor: { uid: actor.uid, delegated: actor.delegated ? delegatedStamp(actor.delegated) : null },
        watcher: settings.enabled ? 'idle' : 'disabled', watcherError: null, observedAt: null, observedFingerprint: null, changeCursor: null, lastFullScanAt: null };
      tx.set(root, updated);
      return publicConfig(updated);
    });
  }
  if (request.action === 'config') return config ? publicConfig(config) : null;
  if (!config) throw new HttpsError('failed-precondition', 'El cliente aún no tiene organizador.');
  switch (request.action) {
    case 'start': {
      if (actor.role === 'revisor') throw new HttpsError('permission-denied', 'El revisor no puede iniciar una ejecución.');
      if (!['inventory', 'dry_run', ...paidModes].includes(request.mode)) throw new HttpsError('invalid-argument', 'Modo inválido.');
      const ids = request.photoIds || [];
      if (!Array.isArray(ids) || ids.length > 100 || ids.length && request.variantId)
        throw new HttpsError('invalid-argument', 'Selecciona hasta 100 fotos o una variante.');
      const photoIds = [...new Set(ids.map(checkedId))].sort();
      const variantId = request.variantId === undefined ? undefined : checkedId(request.variantId);
      if ((photoIds.length || variantId) && request.mode !== 'classify') throw new HttpsError('invalid-argument', 'El reanálisis requiere el modo clasificación.');
      if (variantId && !(await root.collection('products').doc(variantId).get()).exists) throw new HttpsError('not-found', 'Variante no disponible.');
      if (photoIds.length) {
        const photos = await getAppFirestore().getAll(...photoIds.map(id => root.collection('photos').doc(id)));
        if (photos.some(photo => !photo.exists)) throw new HttpsError('not-found', 'Una fotografía no está disponible.');
      }
      if (requiresCopy(request.mode) && !photoIds.length && !variantId && !request.planRunId)
        throw new HttpsError('failed-precondition', 'Simula y revisa el plan antes de aplicar cambios.');
      return enqueue(clientId, request.mode, checkedId(request.requestId), actor.uid, {
        confirmedBudgetUsd: request.confirmedBudgetUsd, photoIds, variantId, planRunId: request.planRunId ? checkedId(request.planRunId) : undefined, delegated: actor.delegated ? delegatedStamp(actor.delegated) : null,
      });
    }
    case 'runs': return listPage<OrganizerRun>(root.collection('runs'), request.cursor).then(page => ({ ...page, items: page.items.map(item => publicRun(item as StoredRun)) }));
    case 'baseProducts': return listPage<OrganizerBaseProduct>(root.collection('baseProducts'), request.cursor);
    case 'interpretations': return listPage<OrganizerInterpretation>(root.collection('interpretations'), request.cursor);
    case 'commercial': return listPage<OrganizerCommercialVariant>(request.variantId ?
      root.collection('commercial').where('variantId', '==', checkedId(request.variantId)) : root.collection('commercial'), request.cursor);
    case 'products':
    case 'tabs':
    case 'photos':
    case 'conflicts': {
      const run = request.runId ? runRef(clientId, checkedId(request.runId)) : null;
      if (run) {
        const summary = (await run.get()).data() as StoredRun | undefined;
        if (!summary || !['dry_run', 'inventory'].includes(summary.mode))
          throw new HttpsError('not-found', 'Simulación no disponible.');
      }
      const scope = run || root;
      if (request.status && !['pending', 'review', 'uploaded'].includes(request.status)) throw new HttpsError('invalid-argument', 'Estado de catálogo inválido.');
      if (request.action === 'products') return listPage<OrganizerVariant>(request.status ? scope.collection('products').where('status', '==', request.status) : scope.collection('products'), request.cursor);
      if (request.action === 'tabs') return listPage<OrganizerTab>(scope.collection('tabs'), request.cursor);
      const photos = scope.collection('photos');
      const query = request.action === 'conflicts' ? photos.where('hasConflict', '==', true)
        : request.variantId ? photos.where(Filter.or(Filter.where('variantIds', 'array-contains', checkedId(request.variantId)),
          Filter.where('variantId', '==', checkedId(request.variantId)))) : photos;
      return listPage<OrganizerPhoto>(query, request.cursor);
    }
    case 'files':
    case 'plan':
    case 'ledger': {
      const run = runRef(clientId, checkedId(request.runId));
      if (!(await run.get()).exists) throw new HttpsError('not-found', 'Ejecución no disponible.');
      if (request.action === 'plan') return listPage<OrganizerPlanItem>(run.collection('plan'), request.cursor);
      if (request.action === 'ledger') return listPage<OrganizerLedgerItem>(run.collection('ledger'), request.cursor);
      const page = await listPage<{ id: string; entry: DriveEntry; added?: boolean; changed?: boolean; copied?: boolean; error?: string }>(
        run.collection('files'), request.cursor);
      return { ...page, items: page.items.map(item => ({ id: item.id, name: item.entry.name, path: item.entry.path, version: versionOf(item.entry),
        added: Boolean(item.added), changed: Boolean(item.changed), copied: Boolean(item.copied), error: item.error || null } as OrganizerRunFile)) };
    }
    case 'provenance': {
      const product = root.collection('products').doc(checkedId(request.variantId));
      if (!(await product.get()).exists) throw new HttpsError('not-found', 'Variante no disponible.');
      return listPage<OrganizerProductRow>(product.collection('provenance'), request.cursor);
    }
    case 'draft': {
      if (actor.role === 'revisor') throw new HttpsError('permission-denied', 'El revisor no puede preparar producción.');
      const variantId = checkedId(request.variantId);
      const [productDoc, decisionDoc] = await getAppFirestore().getAll(root.collection('products').doc(variantId), root.collection('referenceDecisions').doc(variantId));
      const product = productDoc.data() as OrganizerVariant | undefined;
      if (!product || product.referenceState !== 'approved') throw new HttpsError('failed-precondition', 'Se requieren referencias aprobadas.');
      const kind = product.references.front.length && product.references.back.length ? 'garment' : 'product';
      const ids = [...new Set(kind === 'garment' ? [...product.references.front, ...product.references.back] : [...product.references.main, ...(product.references.complementary || [])])].slice(0, 4);
      if (!ids.length) throw new HttpsError('failed-precondition', 'No hay referencias vigentes.');
      const drive = new OrganizerDrive();
      const photos = await Promise.all(ids.map(async id => {
        const source = (await root.collection('sourceFiles').doc(id).get()).data()?.entry as DriveEntry | undefined;
        const photo = (await root.collection('photos').doc(id).get()).data();
        const associated = photo?.variantIds || [photo?.variantId].filter(Boolean);
        const eligible = photo?.referenceEligibleFor || (photo?.variantId ? [photo.variantId] : []);
        if (!source || !photo || !config.sourceIds.includes(source.sourceId) || !associated.includes(variantId) || !eligible.includes(variantId) || decisionDoc.data()?.versions?.[id] !== versionOf(source))
          throw new HttpsError('failed-precondition', 'Cambió una foto aprobada. Revisa de nuevo las referencias.');
        const copy = (await root.collection('manifest').doc(digest([id, versionOf(source)])).get()).data();
        if (!copy?.copiedId) throw new HttpsError('not-found', 'No está disponible la copia de la referencia.');
        const bytes = await sharp(await drive.image(copy.copiedId), { limitInputPixels: 60_000_000 }).rotate()
          .resize(1440, 1440, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
        const view = product.references.front.includes(id) ? 'front' : product.references.back.includes(id) ? 'back' : null;
        return { name: photo.name.replace(/\.[^.]+$/, '') + '.jpg', view, base64: bytes.toString('base64') } as OrganizerDraft['photos'][number];
      }));
      return { name: product.name, color: product.color, kind, photos };
    }
    case 'thumbnail': {
      const photoId = checkedId(request.photoId);
      const [photo, source] = await getAppFirestore().getAll(root.collection('photos').doc(photoId), root.collection('sourceFiles').doc(photoId));
      const entry = source.data()?.entry as DriveEntry | undefined;
      const manifest = entry && config.sourceIds.includes(entry.sourceId)
        ? (await root.collection('manifest').doc(digest([entry.id, versionOf(entry)])).get()).data() : undefined;
      if (!photo.exists || !manifest?.copiedId) throw new HttpsError('not-found', 'Miniatura no disponible.');
      const drive = new OrganizerDrive();
      const preview = await drive.thumbnail(manifest.copiedId);
      if (!preview) throw new HttpsError('not-found', 'Drive aún no tiene una miniatura disponible para esta copia.');
      const bytes = await sharp(preview, { limitInputPixels: 60_000_000 }).rotate()
        .resize(360, 360, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      return { mimeType: 'image/jpeg', base64: bytes.toString('base64') };
    }
    case 'run':
    case 'report':
    case 'pause':
    case 'resume':
    case 'cancel': {
      const run = runRef(clientId, checkedId(request.runId));
      if (request.action === 'run' || request.action === 'report') {
        const data = (await run.get()).data() as StoredRun | undefined;
        if (!data) throw new HttpsError('not-found', 'Ejecución no disponible.');
        return request.action === 'run' ? publicRun(data) : { run: publicRun(data), reportUrl: data.reportUrl, controlSheetUrl: data.controlSheetUrl };
      }
      if (actor.role === 'revisor') throw new HttpsError('permission-denied', 'El revisor no puede controlar ejecuciones.');
      const action = request.action;
      return getAppFirestore().runTransaction(async tx => {
        const [snapshot, current] = await tx.getAll(run, root);
        const data = snapshot.data() as StoredRun | undefined;
        if (!data || current.data()?.activeRunId !== data.id) throw new HttpsError('not-found', 'La ejecución no está activa.');
        const valid = action === 'resume' ? ['paused', 'failed'] : action === 'pause' ? ['queued', 'running'] : ['queued', 'running', 'paused', 'failed', 'budget_exhausted'];
        if (!valid.includes(data.status)) throw new HttpsError('failed-precondition', 'Acción incompatible con el estado actual.');
        // Preserve the lease deadline so a resumed worker cannot overlap any in-flight Drive call.
        const status = action === 'resume' ? 'queued' : action === 'pause' ? 'paused' : 'cancelled';
        if (action === 'cancel' && data.leaseUntil > Date.now()) throw new HttpsError('failed-precondition', 'Pausa la ejecución y espera a que termine la operación en curso.');
        const update = { status, updatedAt: Date.now(), ...(action === 'cancel' ? { lease: null, completedAt: Date.now() } : {}) } as const;
        tx.update(run, update);
        if (action === 'cancel') tx.update(root, { activeRunId: null, watcher: config.enabled ? 'idle' : 'disabled',
          ...(requiresCopy(data.mode) ? { blockedFingerprint: data.fingerprint || config.observedFingerprint } : {}) });
        return publicRun({ ...data, ...update });
      });
    }
    case 'correct': {
      if (request.photoIds !== undefined && !Array.isArray(request.photoIds) || request.variantIds !== undefined && !Array.isArray(request.variantIds) ||
        request.referenceVariantIds !== undefined && !Array.isArray(request.referenceVariantIds))
        throw new HttpsError('invalid-argument', 'Lista de fotos o variantes inválida.');
      const photoIds = [...new Set([checkedId(request.photoId), ...(request.photoIds || []).map(checkedId)])];
      const targets = [...new Set(request.variantIds || (request.variantId ? [request.variantId] : []))].map(checkedId);
      const referenceEligibleFor = [...new Set(request.referenceVariantIds || (targets.length === 1 ? targets : []))].map(checkedId);
      if (referenceEligibleFor.some(id => !targets.includes(id))) throw new HttpsError('invalid-argument', 'Una referencia debe pertenecer a los artículos asociados.');
      if (photoIds.length > 25 || targets.length > 10) throw new HttpsError('invalid-argument', 'Selecciona hasta 25 fotos y 10 variantes.');
      return getAppFirestore().runTransaction(async tx => {
        const current = await tx.get(root);
        const photos = await tx.getAll(...photoIds.map(id => root.collection('photos').doc(id)));
        const sources = await tx.getAll(...photoIds.map(id => root.collection('sourceFiles').doc(id)));
        const affected = [...new Set([...targets, ...photos.flatMap(photo => photo.data()?.variantIds || [photo.data()?.variantId].filter(Boolean))])];
        const variants = affected.length ? await tx.getAll(...affected.map(id => root.collection('products').doc(id))) : [];
        if (photos.some(photo => !photo.exists) || targets.some(id => !variants.some(variant => variant.id === id && variant.exists)) || sources.some(source => !source.exists))
          throw new HttpsError('not-found', 'Foto, origen o variante no disponible.');
        if (current.data()?.activeRunId) throw new HttpsError('failed-precondition', 'Termina la ejecución antes de aplicar correcciones.');
        const seed = photos.find(photo => photo.id === request.photoId)!.data() as OrganizerPhoto;
        const groupKey = (photo: OrganizerPhoto) => digest([photo.path.slice(0, -1), [...photo.candidates].sort()]);
        const selected: string[] = [];
        let result: OrganizerPhoto | null = null;
        for (let index = 0; index < photos.length; index++) {
          const photo = photos[index]; const old = photo.data() as OrganizerPhoto;
          if (photo.id !== request.photoId && (old.reviewedBy || groupKey(old) !== groupKey(seed))) continue;
          const target = targets.length === 1 ? targets[0] : null;
          const entry = sources[index].data()!.entry as DriveEntry;
          const selectedVariants = variants.filter(variant => targets.includes(variant.id)).map(variant => variant.data() as OrganizerVariant);
          const decision = { variantId: target, variantIds: targets, referenceEligibleFor, uid: actor.uid, at: Date.now(), version: versionOf(entry), contextKey: photoDecisionKey(entry, selectedVariants) };
          tx.set(root.collection('decisions').doc(photo.id), decision);
          tx.create(root.collection('reviewHistory').doc(), { ...decision, photoId: photo.id, previousVariantId: old.variantId, type: 'association' });
          const update = { variantId: target, variantIds: targets, referenceEligibleFor, identityState: targets.length > 1 ? 'shared' as const : target ? 'variant' as const : 'unresolved' as const,
            method: 'manual', confidence: targets.length ? 1 : 0, reviewedBy: actor.uid,
            issue: targets.length ? null : 'Sin asociación por decisión humana', hasConflict: !targets.length, updatedAt: Date.now(), visionKey: null };
          tx.update(photo.ref, update); selected.push(photo.id);
          if (photo.id === request.photoId) result = { ...old, ...update };
        }
        for (const variant of variants) if (variant.exists && Object.values((variant.data() as OrganizerVariant).references).flat().some(id => selected.includes(id)))
          tx.update(variant.ref, { referenceState: 'pending', references: { front: [], back: [], main: [] } });
        return result;
      });
    }
    case 'references': {
      if (!['approve', 'reject', 'reset'].includes(request.decision)) throw new HttpsError('invalid-argument', 'Decisión inválida.');
      const variant = root.collection('products').doc(checkedId(request.variantId));
      return getAppFirestore().runTransaction(async tx => {
        const [data, current] = await tx.getAll(variant, root);
        const value = data.data() as OrganizerVariant | undefined;
        if (!value) throw new HttpsError('not-found', 'Variante no disponible.');
        if (current.data()?.activeRunId) throw new HttpsError('failed-precondition', 'Termina la ejecución antes de revisar las referencias.');
        if (request.decision === 'approve' && value.referenceState !== 'suggested')
          throw new HttpsError('failed-precondition', 'La variante necesita una selección completa de referencias.');
        const referenceState = request.decision === 'approve' ? 'approved' : request.decision === 'reject' ? 'rejected' : 'pending';
        const ids = [...new Set(Object.values(value.references).flat())];
        const photos = ids.length ? await tx.getAll(...ids.map(id => root.collection('photos').doc(id))) : [];
        if (request.decision === 'approve' && photos.some(photo => {
          const value = photo.data();
          return !value?.copyUrl || !(value.variantIds || [value.variantId].filter(Boolean)).includes(variant.id) ||
            !(value.referenceEligibleFor || (value.variantId ? [value.variantId] : [])).includes(variant.id);
        }))
          throw new HttpsError('failed-precondition', 'Una de las referencias ya no pertenece a esta variante.');
        const versions = Object.fromEntries(photos.map(photo => [photo.id, photo.data()?.version || '']));
        tx.update(variant, { referenceState });
        const decision = { decision: request.decision, references: value.references, versions, uid: actor.uid, at: Date.now() };
        tx.set(root.collection('referenceDecisions').doc(variant.id), decision);
        tx.create(root.collection('reviewHistory').doc(), { ...decision, variantId: variant.id, previousState: value.referenceState, type: 'references' });
        return { ...value, referenceState };
      });
    }
  }
  throw new HttpsError('invalid-argument', 'Acción inválida.');
}

export const organizerAction = onCall({ secrets: [GOOGLE_PRIVATE_KEY], memory: '512MiB', timeoutSeconds: 120 },
  async request => {
    await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
    const uid = request.auth!.uid;
    const { role } = await loadManglarUser(uid);
    return executeOrganizer(request.data, { uid, role });
  });
