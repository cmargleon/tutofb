import { digest, versionOf, type DriveEntry } from './drive';

export const compare = (entry: DriveEntry) => digest([entry.id, versionOf(entry), entry.path, entry.parents]);
