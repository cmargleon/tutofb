import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '../../../shared/src/types';
export interface DelegatedCaller {
    uid: string;
    role: Role;
    connectionId: string;
    scopes: string[];
    allowedClientIds: string[] | null;
    accessVersion: number;
}
interface Context {
    caller?: DelegatedCaller;
    authorize?: (data: unknown) => Promise<void>;
    budgetId?: string;
}
const context = new AsyncLocalStorage<Context>();
export const getManglarContext = () => context.getStore();
export const withManglarContext = <T>(value: Context, run: () => Promise<T>): Promise<T> => context.run(value, run);
