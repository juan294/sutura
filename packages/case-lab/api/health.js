import release from '../release.json' with { type: 'json' };
import { caseLabEnvironment, createCaseLabHandler, createGitHubDispatchClient, DEMO_REPOSITORY } from '../dist/index.js';

/** Environment is read per invocation; see api/dispatch.js. */
function handlerFor(env) {
  const environment = caseLabEnvironment(env, release);
  return createCaseLabHandler(environment, {
    github: createGitHubDispatchClient({ repository: DEMO_REPOSITORY, token: environment.token }),
  });
}

export default async function health(request, response) {
  let result;
  try {
    result = await handlerFor(process.env)({
      method: request.method ?? 'GET',
      path: '/api/health',
      contentType: request.headers['content-type'],
      body: '',
    });
  } catch {
    result = { status: 500, headers: { 'Cache-Control': 'no-store' }, body: { error: 'dispatcher unavailable' } };
  }
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(result.body));
}
