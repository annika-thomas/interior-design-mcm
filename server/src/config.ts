import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Paths are resolved from this file's own location, not from `process.cwd()`.
 *
 * npm runs a workspace script with the cwd set to that workspace, so a
 * cwd-relative path put the database under `server/data` and made the server
 * look for the built front end at `server/web/dist` — which meant `npm start`
 * served a 404 while `node server/src/index.ts` from the root worked fine.
 */
const here = path.dirname(fileURLToPath(import.meta.url));   // server/src
const repoRoot = path.resolve(here, '..', '..');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(repoRoot, 'data');

export const config = {
  port: Number(process.env.PORT || 8787),
  repoRoot,
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'db.json'),
  /** The built front end, served in single-process mode. */
  webDist: path.join(repoRoot, 'web', 'dist'),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.MCM_MODEL || 'claude-opus-5',
  /** Hard cap per uploaded file. Phone photos are ~3-8 MB; short clips can be larger. */
  maxUploadBytes: 64 * 1024 * 1024,
  get hasClaude() {
    return Boolean(this.anthropicApiKey);
  },
};

export function ensureDirs() {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}
