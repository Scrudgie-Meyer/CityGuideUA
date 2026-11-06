/** Runtime paths shared by the HTTP server and catalogue management commands. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** Require persistent storage configuration on Railway; default locally to data/. */
export function databasePath(environment = process.env) {
  const mount = environment.RAILWAY_VOLUME_MOUNT_PATH;
  if (environment.RAILWAY_ENVIRONMENT_ID && !mount) {
    throw new Error('Attach a Railway Volume at /app/data before starting the database service');
  }
  return (
    environment.DATABASE_PATH ??
    path.join(mount ?? path.join(projectRoot, 'data'), 'cityguide.sqlite')
  );
}
