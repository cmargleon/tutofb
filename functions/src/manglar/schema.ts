import { HttpsError } from 'firebase-functions/v2/https';
import contracts from './contracts.json';
export type Schema = {
    type?: string;
    const?: unknown;
    enum?: unknown[];
    properties?: Record<string, Schema | boolean>;
    required?: string[];
    additionalProperties?: Schema | boolean;
    items?: Schema | boolean;
    anyOf?: Array<Schema | boolean>;
    minItems?: number;
    maxItems?: number;
    maxProperties?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
};
export const contractSchema = (name: string): Schema => {
    const schema = (contracts as unknown as Record<string, Schema>)[name];
    if (!schema)
        throw new Error(`Missing MCP contract: ${name}`);
    return schema;
};
export const validateSchema = (value: unknown, schema: Schema | boolean, path = 'data', depth = 0): void => {
    const invalid = () => { throw new HttpsError('invalid-argument', `Parámetro inválido: ${path}.`); };
    if (depth > 20 || schema === false)
        return invalid();
    if (schema === true)
        return;
    if (schema.anyOf) {
        if (!schema.anyOf.some((option) => { try {
            validateSchema(value, option, path, depth + 1);
            return true;
        }
        catch {
            return false;
        } }))
            invalid();
        return;
    }
    if ('const' in schema && value !== schema.const)
        invalid();
    if (schema.enum && !schema.enum.includes(value))
        invalid();
    switch (schema.type) {
        case 'null':
            if (value !== null)
                invalid();
            break;
        case 'boolean':
            if (typeof value !== 'boolean')
                invalid();
            break;
        case 'integer': if (typeof value !== 'number' || !Number.isInteger(value))
            invalid();
        // Fall through to shared numeric bounds.
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))
                invalid();
            break;
        case 'string':
            if (typeof value !== 'string' || value.length > (schema.maxLength ?? 30000) || /[\u0000]/.test(value))
                invalid();
            break;
        case 'array': {
            if (!Array.isArray(value) || value.length > (schema.maxItems ?? 100) || value.length < (schema.minItems ?? 0))
                return invalid();
            for (const entry of value)
                validateSchema(entry, schema.items ?? false, path, depth + 1);
            break;
        }
        case 'object': {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return invalid();
            const object = value as Record<string, unknown>;
            if (Object.keys(object).length > (schema.maxProperties ?? 100) || schema.required?.some((key) => !Object.hasOwn(object, key)))
                invalid();
            for (const [key, entry] of Object.entries(object)) {
                if (['__proto__', 'prototype', 'constructor'].includes(key))
                    invalid();
                const property = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : schema.additionalProperties ?? false;
                validateSchema(entry, property, `${path}.${key}`, depth + 1);
            }
            break;
        }
    }
};
