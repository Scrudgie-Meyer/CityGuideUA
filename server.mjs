/** Process entry point; HTTP handlers and domain logic live in src/. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './src/http-server.mjs';
export { createAppServer };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () =>
    console.log(`CityGuide UA listening on http://0.0.0.0:${port}`),
  );
  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
