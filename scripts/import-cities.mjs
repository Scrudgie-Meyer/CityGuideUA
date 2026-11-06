/** Administrator CLI: extend the persistent catalogue using real Wikidata QIDs. */
import { CityRepository } from '../src/data/city-repository.mjs';
import { CatalogService } from '../src/services/catalog-service.mjs';
import { databasePath } from '../src/config.mjs';
const ids = process.argv.slice(2);
if (!ids.length) {
  throw new Error('Usage: npm run import -- Q157053 Q156726');
}
const repository = new CityRepository(databasePath());
try {
  const service = new CatalogService(repository);
  await service.importCities(ids);
  console.log(repository.stats());
} finally {
  repository.close();
}
