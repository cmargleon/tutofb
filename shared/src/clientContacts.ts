import type { ClientContact } from './types/client';

export const MAX_CLIENT_CONTACTS = 100;

export function isClientContactsDraft(value: unknown): value is ClientContact[] {
  return Array.isArray(value) && value.length <= MAX_CLIENT_CONTACTS && value.every(contact =>
    contact && typeof contact === 'object' && typeof contact.name === 'string' && typeof contact.email === 'string');
}

export function normalizeClientContacts(value: unknown): ClientContact[] {
  if (!isClientContactsDraft(value)) throw new Error(`Indica una lista de hasta ${MAX_CLIENT_CONTACTS} contactos con nombre y correo.`);
  return value.map((contact, index) => {
    const name = contact.name.trim();
    const email = contact.email.trim();
    if (!name || name.length > 500) throw new Error(`Indica el nombre del contacto ${index + 1} (máximo 500 caracteres).`);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Indica un correo válido para el contacto ${index + 1}.`);
    return { name, email };
  });
}
