import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config, ensureDirs } from './config.js';
import { router as projectsRouter } from './routes/projects.js';
import { router as photosRouter } from './routes/photos.js';
import { router as libraryRouter } from './routes/library.js';
import { router as planRouter } from './routes/plan.js';
import { router as exportRouter } from './routes/export.js';

ensureDirs();

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    // The UI uses this to decide whether to offer the vision features or
    // explain how to turn them on.
    claude: config.hasClaude,
    model: config.hasClaude ? config.model : null,
  });
});

app.use('/api', projectsRouter);
app.use('/api', photosRouter);
app.use('/api', libraryRouter);
app.use('/api', planRouter);
app.use('/api', exportRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint' }));

// Serve the built front end when it exists, so `npm start` runs the whole app.
const webDist = path.resolve(process.cwd(), 'web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

interface HttpError extends Error { status?: number; code?: string }

app.use((err: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `That file is over the ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB limit.` });
  }
  console.error('[error]', err);
  res.status(err?.status ?? 500).json({ error: err?.message || 'Something went wrong on the server.' });
});

app.listen(config.port, () => {
  console.log(`\n  MCM apartment planner`);
  console.log(`  API    http://localhost:${config.port}/api`);
  console.log(`  Data   ${config.dataDir}`);
  console.log(`  Claude ${config.hasClaude ? `on (${config.model})` : 'off — set ANTHROPIC_API_KEY for photo survey and library analysis'}`);
  if (fs.existsSync(webDist)) console.log(`  App    http://localhost:${config.port}`);
  console.log('');
});
