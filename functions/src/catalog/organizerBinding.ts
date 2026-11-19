import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import type { MasterVariant, OrganizerCommercialSource, OrganizerVariant, ProductEvidence, StoredMasterProduct } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { code } from '../organizer/catalog';
import { colorsCompatible } from '../organizer/baseCode';
import { catalogDigest, catalogMetadata, normalizeCatalogSearch } from './model';
import { assertCatalogSize } from './validation';

/**
 * Automatic, conservative binding of an organizer base code to one canonical master product.
 *
 * The base code is an external commercial reference, never the primary key: the binding is a
 * `productAliases` document whose ID is derived from the code, so a code maps to at most one
 * product per client, while the product keeps its own stable ID.
 *
 * Binding is not merging: it only routes future generations to the product. Manual values,
 * publications and selected images keep their precedence. It binds automatically only when the
 * evidence is unambiguous; otherwise it records an issue and leaves generation unbound.
 */
export const BINDING_UID = 'organizer-binding';
export const baseAliasId = (baseCode: string) => `organizer-base-${catalogDigest(['organizer-base', code(baseCode)]).slice(0, 40)}`;

export type CatalogCandidate = { id: string; data: StoredMasterProduct };
export type BindingResult = { productId: string; created: boolean; issue: null } | { productId: null; created: false; issue: string };

const codes = (variant: Pick<MasterVariant, 'values'>) => [variant.values.sku, variant.values.skc].filter((value): value is string => Boolean(value)).map(code);

/** Pure decision over the candidate products found by exact reference search. */
export function chooseBindingTarget(baseCode: string, variant: Pick<OrganizerVariant, 'skcs' | 'skus' | 'color'>, candidates: CatalogCandidate[]):
  { action: 'link'; productId: string } | { action: 'create' } | { action: 'issue'; issue: string } {
  const base = code(baseCode);
  const references = new Set([...variant.skcs, ...variant.skus].map(code).filter(Boolean));
  const matches = candidates.filter(({ data }) => !data.catalog?.redirectTo && data.catalog?.status !== 'archived' && (
    code(data.values.sku || '') === base ||
    data.variants.some(row => code(row.values.spu || '') === base || codes(row).some(value => references.has(value)))));
  if (!matches.length) return { action: 'create' };
  if (matches.length > 1) return { action: 'issue', issue: `El código ${base} coincide con ${matches.length} fichas del catálogo maestro (${matches.slice(0, 3).map(item => item.id).join(', ')}). Asócialo manualmente.` };
  const [target] = matches;
  const contradiction = target.data.variants.find(row => codes(row).some(value => references.has(value)) &&
    colorsCompatible(row.values.color || '', variant.color) === false);
  if (contradiction) return { action: 'issue', issue: `La ficha ${target.id} tiene ${codes(contradiction).join('/')} con color ${contradiction.values.color}, distinto del Excel (${variant.color}).` };
  return { action: 'link', productId: target.id };
}

export function organizerDraftProduct(clientId: string, baseCode: string, baseId: string, source: OrganizerCommercialSource): StoredMasterProduct {
  const reference = `organizers/${clientId}/baseProducts/${baseId}`;
  const evidence: Record<string, ProductEvidence> = {};
  const values = Object.fromEntries(Object.entries(source.values).filter(([, value]) => typeof value === 'string' && value.trim())) as StoredMasterProduct['values'];
  for (const [field, value] of Object.entries(values)) evidence[field] = { original: value!, normalized: value!, source: 'drive', confidence: null, state: 'confirmed', reference };
  const variants: MasterVariant[] = (source.issue ? [] : source.variants).map(variant => ({ id: variant.id, values: { ...variant.values, spu: code(baseCode) },
    ...(variant.attributes ? { attributes: variant.attributes } : {}) }));
  for (const variant of variants) for (const [field, value] of Object.entries(variant.values))
    if (value) evidence[`variant.${variant.id}.${field}`] = { original: value, normalized: value, source: 'drive', confidence: null, state: 'confirmed', reference };
  const catalog = catalogMetadata({ values, variants, catalog: undefined }, admin.firestore.FieldValue.serverTimestamp());
  catalog.evidence = evidence;
  catalog.attributes = { organizerBaseCode: code(baseCode) };
  const data: StoredMasterProduct = { clientId, values, variants, marketplaces: {}, revision: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedByUid: BINDING_UID, catalog };
  assertCatalogSize(data);
  return data;
}

async function findCandidates(clientId: string, baseCode: string, variant: Pick<OrganizerVariant, 'skcs' | 'skus'>) {
  const keys = [...new Set([baseCode, ...variant.skcs, ...variant.skus].map(normalizeCatalogSearch).filter(Boolean))].slice(0, 30);
  const products = getAppFirestore().collection('clients').doc(clientId).collection('products');
  const snapshot = await products.where('catalog.searchKeys', 'array-contains-any', keys).limit(25).get();
  return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() as StoredMasterProduct })).filter(item => item.data.clientId === clientId);
}

/** Idempotent: an existing binding always wins; creation and binding commit in one transaction. */
export async function bindOrganizerBase(clientId: string, baseCode: string, baseId: string, variant: OrganizerVariant,
  source: OrganizerCommercialSource): Promise<BindingResult> {
  const db = getAppFirestore();
  const client = db.collection('clients').doc(clientId);
  const aliasRef = client.collection('productAliases').doc(baseAliasId(baseCode));
  const existing = await aliasRef.get();
  if (existing.exists) return followBinding(clientId, existing.get('productId'));
  const decision = chooseBindingTarget(baseCode, variant, await findCandidates(clientId, baseCode, variant));
  if (decision.action === 'issue') return { productId: null, created: false, issue: decision.issue };
  return db.runTransaction(async tx => {
    const [alias, clientDoc] = await tx.getAll(aliasRef, client);
    if (!clientDoc.exists || clientDoc.get('status') === 'archived') return { productId: null, created: false, issue: 'Cliente no disponible.' } as BindingResult;
    if (alias.exists) return { productId: alias.get('productId') as string, created: false, issue: null } as BindingResult;
    const productId = decision.action === 'link' ? decision.productId : randomUUID();
    const productRef = client.collection('products').doc(productId);
    const product = await tx.get(productRef);
    if (decision.action === 'link' && (!product.exists || product.get('catalog.redirectTo'))) return { productId: null, created: false, issue: 'La ficha candidata cambió; se reintentará.' } as BindingResult;
    if (decision.action === 'create') tx.create(productRef, organizerDraftProduct(clientId, baseCode, baseId, source));
    tx.create(aliasRef, { clientId, productId, origin: 'organizer', kind: 'base', baseCode: code(baseCode), baseId,
      createdBy: BINDING_UID, createdAt: Date.now(), decision: decision.action });
    return { productId, created: decision.action === 'create', issue: null } as BindingResult;
  });
}

async function followBinding(clientId: string, productId: string): Promise<BindingResult> {
  const products = getAppFirestore().collection('clients').doc(clientId).collection('products');
  let id = productId;
  // A binding follows the canonical product if it was later associated to another one.
  for (let hops = 0; hops < 3; hops++) {
    const snapshot = await products.doc(id).get();
    if (!snapshot.exists) return { productId: null, created: false, issue: 'La ficha vinculada al código ya no existe.' };
    const next = snapshot.get('catalog.redirectTo');
    if (!next) return { productId: id, created: false, issue: null };
    id = next;
  }
  return { productId: null, created: false, issue: 'Cadena de redirecciones de ficha demasiado larga.' };
}

/**
 * Variant mapping for a generation routed by an organizer binding: source variants are matched to
 * the canonical product's variants by exact SKU/SKC only. Unmatched variants are added, never merged.
 */
export function mapVariantsByCode(source: Pick<MasterVariant, 'id' | 'values'>[], target: Pick<MasterVariant, 'id' | 'values'>[]) {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const variant of source) {
    const own = codes(variant);
    const matches = target.filter(row => !used.has(row.id) && codes(row).some(value => own.includes(value)));
    if (matches.length === 1) { map[variant.id] = matches[0].id; used.add(matches[0].id); }
  }
  return map;
}
