import type { FastifyPluginAsync } from 'fastify';

import { renderLlmsTxt, renderSkillMd } from '../agent-docs.js';
import { buildIndexOpenApiDocument } from '../openapi-index.js';
import { DOCUMENT_VERSION } from '../openapi-shared.js';

/// The description files, served.
///
///     GET /llms.txt            the index file
///     GET /skill.md            the skill
///     GET /openapi/index.json  the index feed's OpenAPI document
///
/// All three are free, all three are outside `/v1/`, and none of them touches
/// the database. An agent that has never seen this API is handed one URL and
/// has to be able to get from it to a correct paid call without asking a
/// person, which is the acceptance line this ticket is built around; a
/// description file that has to be found in a repository does not do that.
///
/// The same bytes are committed under recipes/bazantic/agentify/, written by
/// `pnpm api:openapi`, because Bazantic imports a file and a judge reads a
/// repository. A test compares the served copy with the committed one.
///
/// The origin is not read from the request. Every URL in these files is the
/// public origin, for the same reason the OpenAPI document has one `servers`
/// entry and no localhost: a description file fetched through a tunnel or from
/// a laptop must not teach an agent an address that stops answering.
///
/// The public host routes these three paths to the API rather than to the web
/// app; see the Caddy site file in deploy/.

export const agentDocsRoutes: FastifyPluginAsync = async (app) => {
  const llms = renderLlmsTxt();
  const skill = renderSkillMd();
  const document = buildIndexOpenApiDocument({ version: DOCUMENT_VERSION });

  app.get('/llms.txt', async (_request, reply) =>
    reply.type('text/plain; charset=utf-8').send(llms),
  );

  app.get('/skill.md', async (_request, reply) =>
    reply.type('text/markdown; charset=utf-8').send(skill),
  );

  app.get('/openapi/index.json', async (_request, reply) => reply.send(document));
};
