import { buildServer } from './server.js';

/// The entry point. `pnpm api:dev` runs this; the server itself is in
/// server.ts so a test can build one without listening on a port.

const port = Number(process.env.PORT ?? 3210);
const host = process.env.HOST ?? '127.0.0.1';

const app = await buildServer();
await app.listen({ port, host });
