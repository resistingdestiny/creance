import { buildServer } from './server.js';
import { backfillObservations, syncSeries } from './services.js';

/// The entry point. `pnpm api:dev` runs this; the server itself is in
/// server.ts so a test can build one without listening on a port.
///
/// The index history is loaded into `observations` at boot, because the oracle
/// that would publish it is T12 and does not exist yet. Existing rows are left
/// alone, so a second start writes nothing.

const port = Number(process.env.PORT ?? 3210);
const host = process.env.HOST ?? '127.0.0.1';

const app = await buildServer();
const series = await syncSeries(app.services);
const written = await backfillObservations(app.services);
app.log.info({ series, observations: written }, 'series and index history loaded');
await app.listen({ port, host });
