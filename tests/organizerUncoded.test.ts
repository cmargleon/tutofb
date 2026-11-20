import assert from 'node:assert/strict';
import { test } from 'node:test';
import { associatePhotos, associationIndex, groupProductRows, parseTab, productVariant } from '../functions/lib/functions/src/organizer/catalog.js';
import { associateByBaseCode, buildBaseCodeIndex } from '../functions/lib/functions/src/organizer/baseCode.js';
import { acceptObservation, visualAssociation } from '../functions/lib/functions/src/organizer/interpretation.js';
import { createRequire } from 'node:module';
const { commercialIdentityOf, uncodedGroupName } = createRequire(import.meta.url)('../functions/lib/shared/src/organizerIdentity.js') as typeof import('../shared/src/organizerIdentity');
import { groupGenerationSources } from '../functions/lib/functions/src/organizer/automation.js';
import type { OrganizerPhoto } from '../shared/src/types';

const names = ['SINCOD_BUZO-TIEDYE_FRENTE_01.jpg', 'SINCOD_BUZO-TIEDYE_ESPALDA_01.jpg'];
const { rows } = parseTab({ id: 'excel', name: 'JISHOP.xlsx' }, 'Productos', null, [
  ['Código base', 'SKC', 'Nombre', 'Color'], ['JST-M05', 'JST-M05-AZU', 'Buzo tiedye', 'Azul'], ['JST-M03', 'JST-M03-FLO', 'Buzo tiedye', 'Azul'],
]);
const { groups } = groupProductRows(rows);
const variants = [...groups].map(([id, entries]) => productVariant(id, entries));
const files = names.map((name, index) => ({ id: `photo${index}`, name, path: ['Origen', 'JST-M05', name], parents: ['folder'], sourceId: 'origin', mimeType: 'image/jpeg', version: '1' }));
const photo = (index: number): OrganizerPhoto => ({ ...files[index], sourceUrl: '', copyUrl: null, variantId: null, candidates: [], method: 'pendiente', evidence: [], confidence: 0, issue: null, duplicateOf: null, reviewedBy: null, view: index ? 'back' : 'front' });

test('JISHOP: ambos SINCOD carecen de base y candidatos en legacy y baseCode, incluso bajo una carpeta con código', () => {
  for (const result of [associatePhotos(files, associationIndex(variants), new Map()), associateByBaseCode(files, buildBaseCodeIndex(variants, rows), new Map())]) {
    for (const file of files) {
      const association = result.get(file.id)!;
      assert.equal(association.variantId, null);
      assert.deepEqual(association.candidates, []);
      assert.match(association.issue!, /Sin ficha comercial/);
      assert.equal('baseId' in association ? association.baseId : null, null);
    }
  }
  const match = visualAssociation(photo(0), variants, { kind: 'garment', label: 'Buzo tiedye', color: 'Azul', pack: '', photos: [] });
  assert.equal(match.baseId, null);
  assert.equal(match.variantId, null);
  assert.deepEqual(match.ranked, []);
});

test('sin código reconocible tampoco hereda identidad por carpeta o píxeles', () => {
  const file = { ...files[0], name: 'buzo_frente.jpg' };
  assert.equal(associatePhotos([file], associationIndex(variants), new Map()).get(file.id)!.variantId, null);
  assert.equal(visualAssociation({ ...photo(0), name: file.name }, variants, { kind: 'garment', label: 'Buzo tiedye', color: 'Azul', pack: '', photos: [] }).baseId, null);
});

test('JISHOP: frente y espalda comparten artículo aunque existan sugerencias históricas distintas', () => {
  assert.equal(uncodedGroupName(names[0]), 'SINCOD_BUZO-TIEDYE');
  assert.equal(uncodedGroupName(names[0]), uncodedGroupName(names[1]));
  const photos = files.map((entry, index) => ({ entry, photo: { ...photo(index), baseId: index ? 'JST-M03' : 'JST-M05', variantId: variants[index].id } }));
  assert.equal(groupGenerationSources(photos).length, 1);
  for (const source of photos) {
    const current = commercialIdentityOf(source.photo);
    assert.equal(current.baseId, null);
    assert.equal(current.variantId, null);
    assert.equal(current.identityState, 'unresolved');
  }
});

test('una negativa de Gemini elimina la base sugerida incluso si devuelve un ID contradictorio', () => {
  const checked = { ranked: [], variantId: variants[0].id, baseId: 'JST-M05' };
  for (const variantId of [null, variants[0].id]) {
    const result = acceptObservation(checked, { variantId, evidence: ['visual', 'catalog'], unresolved: 'No existe un producto en el catálogo que corresponda a esta prenda.' });
    assert.equal(result.baseId, null);
    assert.equal(result.variantId, null);
  }
});

test('grupos SINCOD distintos no se unen por tener frente/espalda, tipo y color iguales', () => {
  const sources = files.map((entry, index) => ({ entry, photo: { ...photo(index), name: index ? 'SINCOD_OTRO-BUZO_ESPALDA_01.jpg' : names[0], kind: 'garment', visualHint: { groupId: String(index), kind: 'garment', label: 'Buzo', color: 'Azul', pack: '' } } }));
  assert.equal(groupGenerationSources(sources).length, 2);
});
