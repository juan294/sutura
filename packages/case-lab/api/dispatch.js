import release from '../release.json' with { type: 'json' };
import { caseLabEnvironment, createCaseLabHandler, createGitHubDispatchClient, DEMO_REPOSITORY } from '../dist/index.js';

const MAX_BODY_BYTES = 1_024;

function readBody(request) {
  if (typeof request.body === 'string') return Promise.resolve(request.body);
  if (request.body !== undefined && request.body !== null && typeof request.body === 'object') {
    return Promise.resolve(JSON.stringify(request.body));
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('body exceeds 1 KiB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

let handler;

function handlerFor(env) {
  if (!handler) {
    const environment = caseLabEnvironment(env, release);
    handler = createCaseLabHandler(environment, {
      github: createGitHubDispatchClient({ repository: DEMO_REPOSITORY, token: environment.token }),
    });
  }
  return handler;
}

export default async function dispatch(request, response) {
  let body;
  try {
    body = await readBody(request);
  } catch {
    response.statusCode = 413;
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify({ error: 'request exceeds 1 KiB' }));
    return;
  }
  let result;
  try {
    result = await handlerFor(process.env)({
      method: request.method ?? 'GET',
      path: '/api/dispatch',
      contentType: request.headers['content-type'],
      body,
    });
  } catch {
    result = { status: 500, headers: { 'Cache-Control': 'no-store' }, body: { error: 'dispatcher unavailable' } };
  }
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(result.body));
}
