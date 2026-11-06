// A connector adapter supplies lists, native copies and a durable checkpoint.
// After an uncertain write, reconcile by reading its parent before any retry.
export async function copyThroughConnector(plan, rootId, transport, journal, width = 10) {
  const folders = new Map(journal.folders || []);
  folders.set('[]', rootId);
  const receipts = new Map((journal.receipts || []).map(copy => [copy.sourceFileId, copy]));
  const errors = [];
  const snapshot = () => ({ folders: [...folders], receipts: [...receipts.values()], errors: [...errors] });
  const persist = () => transport.checkpoint(snapshot());
  const entries = new Map(plan.files.map(file => [file.id, file]));
  const directory = new Map();
  for (const copy of plan.copies) {
    for (let length = 1; length <= copy.directories.length; length++) {
      const path = copy.directories.slice(0, length);
      directory.set(JSON.stringify(path), path);
    }
  }
  directory.set(JSON.stringify(['04 - REPORTES']), ['04 - REPORTES']);
  const run = async (items, operation) => {
    for (let index = 0; index < items.length; index += width) {
      const batch = items.slice(index, index + width);
      await Promise.allSettled(batch.map(operation));
      await persist();
    }
  };
  for (let depth = 1; depth <= Math.max(...[...directory.values()].map(path => path.length)); depth++) {
    await run([...directory].filter(([, path]) => path.length === depth), async ([key, path]) => {
      if (folders.has(key)) return;
      const parent = folders.get(JSON.stringify(path.slice(0, -1)));
      const name = path.at(-1);
      if (!parent) return;
      try {
        const result = await transport.createFolder(parent, name);
        folders.set(key, result.id);
      } catch {
        const candidates = await transport.list(parent).catch(() => []);
        const matching = candidates.filter(entry => entry.folder && entry.name === name);
        if (matching.length === 1) folders.set(key, matching[0].id);
        else errors.push(`Carpeta no confirmada · ${path.join(' / ')}`);
      }
    });
  }
  await run(plan.copies, async operation => {
    if (receipts.has(operation.fileId)) return;
    const parentId = folders.get(JSON.stringify(operation.directories));
    if (!parentId) return;
    const file = entries.get(operation.fileId);
    try {
      const copy = await transport.copy(parentId, operation.name, file);
      if (copy.id === file.id) throw new Error('La copia devolvió el ID del origen');
      receipts.set(file.id, { sourceFileId: file.id, name: operation.name, parentId, ...copy, verified: false });
    } catch {
      const candidates = await transport.list(parentId).catch(() => []);
      const matching = candidates.filter(entry => entry.id !== file.id && entry.name === operation.name &&
        entry.mimeType === file.mimeType && (!file.size || entry.size === file.size));
      if (matching.length === 1) {
        const copy = matching[0];
        receipts.set(file.id, { sourceFileId: file.id, id: copy.id, name: operation.name, parentId,
          url: copy.url, verified: false });
      } else errors.push(`Copia no confirmada · ${file.id}`);
    }
  });
  const leaves = new Map();
  for (const copy of receipts.values()) {
    if (!leaves.has(copy.parentId)) leaves.set(copy.parentId, []);
    leaves.get(copy.parentId).push(copy);
  }
  await run([...leaves], async ([parent, copies]) => {
    const children = await transport.list(parent).catch(() => []);
    const byId = new Map(children.map(child => [child.id, child]));
    for (const copy of copies) {
      const file = entries.get(copy.sourceFileId);
      const actual = byId.get(copy.id);
      copy.verified = Boolean(actual && actual.name === copy.name && actual.mimeType === file.mimeType &&
        (!file.size || actual.size === file.size));
      if (!copy.verified) errors.push(`Fallo de verificación · ${copy.sourceFileId}`);
    }
  });
  return snapshot();
}
