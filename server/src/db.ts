import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Furniture, LibraryItem, Opening, Photo, Project, Room, Suggestion } from './types.js';

/**
 * A tiny JSON-file document store.
 *
 * Deliberately not SQLite: this is a single-user planning tool whose heavy data
 * (photos, video) lives on disk as files, leaving only a few thousand small
 * metadata records here. Keeping it dependency-free means the app runs anywhere
 * Node does, with no native build step. Writes are atomic (write-temp + rename)
 * and debounced, so a crash mid-save cannot truncate the database.
 */
export interface Schema {
  version: number;
  projects: Project[];
  rooms: Room[];
  openings: Opening[];
  furniture: Furniture[];
  photos: Photo[];
  library: LibraryItem[];
  suggestions: Suggestion[];
}

const EMPTY: Schema = {
  version: 1,
  projects: [],
  rooms: [],
  openings: [],
  furniture: [],
  photos: [],
  library: [],
  suggestions: [],
};

let cache: Schema | null = null;
let writeTimer: NodeJS.Timeout | null = null;
let writing = false;
let dirtyAgain = false;

function load(): Schema {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(config.dbFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Schema>;
    cache = { ...EMPTY, ...parsed };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      // A corrupt database is worth preserving rather than silently replacing.
      const backup = `${config.dbFile}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(config.dbFile, backup);
        console.error(`[db] could not parse ${config.dbFile}; backed up to ${backup}`);
      } catch { /* the file may simply not exist */ }
    }
    cache = structuredClone(EMPTY);
  }
  return cache!;
}

function flush() {
  if (writing) {
    dirtyAgain = true;
    return;
  }
  writing = true;
  const snapshot = JSON.stringify(cache, null, 2);
  const tmp = `${config.dbFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    fs.writeFileSync(tmp, snapshot);
    fs.renameSync(tmp, config.dbFile);
  } catch (err) {
    console.error('[db] write failed', err);
  } finally {
    writing = false;
    if (dirtyAgain) {
      dirtyAgain = false;
      flush();
    }
  }
}

/** Persist within 50 ms. Repeated edits in one request coalesce into one write. */
export function save() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush();
  }, 50);
}

/** Force a synchronous write — used on shutdown. */
export function saveNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flush();
}

export const db = {
  get data(): Schema {
    return load();
  },

  table<K extends keyof Omit<Schema, 'version'>>(name: K): Schema[K] {
    return load()[name];
  },

  insert<K extends keyof Omit<Schema, 'version'>>(name: K, row: Schema[K][number]): Schema[K][number] {
    (load()[name] as unknown[]).push(row);
    save();
    return row;
  },

  find<K extends keyof Omit<Schema, 'version'>>(
    name: K,
    predicate: (row: Schema[K][number]) => boolean,
  ): Schema[K][number] | undefined {
    return (load()[name] as Schema[K][number][]).find(predicate);
  },

  filter<K extends keyof Omit<Schema, 'version'>>(
    name: K,
    predicate: (row: Schema[K][number]) => boolean,
  ): Schema[K][number][] {
    return (load()[name] as Schema[K][number][]).filter(predicate);
  },

  update<K extends keyof Omit<Schema, 'version'>>(
    name: K,
    id: string,
    patch: Partial<Schema[K][number]>,
  ): Schema[K][number] | undefined {
    const rows = load()[name] as Array<{ id: string }>;
    const row = rows.find((r) => r.id === id);
    if (!row) return undefined;
    Object.assign(row, patch);
    save();
    return row as Schema[K][number];
  },

  remove<K extends keyof Omit<Schema, 'version'>>(
    name: K,
    predicate: (row: Schema[K][number]) => boolean,
  ): number {
    const rows = load()[name] as Schema[K][number][];
    const keep = rows.filter((r) => !predicate(r));
    const removed = rows.length - keep.length;
    (load() as unknown as Record<string, unknown>)[name as string] = keep;
    if (removed) save();
    return removed;
  },
};

process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
