/** Administrator CLI: consistent SQLite backup including committed WAL transactions. */
import path from 'node:path';
import { CityRepository } from '../src/data/city-repository.mjs';
import { databasePath } from '../src/config.mjs';
const destination = process.argv[2];
if (!destination) {
  throw new Error('Usage: npm run backup -- data/backup.sqlite');
}
const repository = new CityRepository(databasePath());
try {
  repository.backup(path.resolve(destination));
  console.log('Backup created:', destination);
} finally {
  repository.close();
}
