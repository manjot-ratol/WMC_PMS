/* Writes openapi/openapi.json from the live Nest application. Run: npm run openapi:export */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createApiApp } from '../src/app/bootstrap';
import { buildOpenApiDocument } from '../src/common/swagger/swagger.setup';
import { APP_VERSION } from '../src/app/version';

async function main(): Promise<void> {
  const app = await createApiApp();
  await app.init();
  const doc = buildOpenApiDocument(app, APP_VERSION);
  const out = path.resolve(__dirname, '..', 'openapi', 'openapi.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  await app.close();
  console.log(`wrote ${out}`);
}
void main();
