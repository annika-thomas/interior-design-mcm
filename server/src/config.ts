import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(process.cwd());
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));

export const config = {
  port: Number(process.env.PORT || 8787),
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'db.json'),
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
