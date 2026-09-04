import release from '../release.json' with { type: 'json' };
import { caseLabEnvironment, createCaseLabHandler, createGitHubDispatchClient, DEMO_REPOSITORY } from '../dist/index.js';

const MAX_BODY_BYTES = 1_024;

class BodyTooLarge extends Error {}

function bounded(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new BodyTooLarge('body exceeds 1 KiB');
  return text;
}

function readBody(request) {
  if (typeof request.body === 'string') return Promise.resolve(bounded(request.body));
  if (request.body !== undefined && request.body !== null && typeof request.body === 'object') {
    return Promise.resolve(bounded(JSON.stringify(request.body)));
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new BodyTooLarge('body exceeds 1 KiB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * The environment is read on every invocation so a changed CASE_LAB_ENABLED
 * takes effect at the next request of a warm instance, not only after a cold
 * start. The workflow's own repository-variable gate remains the backstop.
 */
function handlerFor(env) {
  const environment = caseLabEnvironment(env, release);
  return createCaseLabHandler(environment, {
    github: createGitHubDispatchClient({ repository: DEMO_REPOSITORY, token: environment.token }),
  });
}

function send(response, result) {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(result.body));
}

export default async function dispatch(request, response) {
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    send(response, {
      status: error instanceof BodyTooLarge ? 413 : 400,
      headers: { 'Cache-Control': 'no-store' },
      body: { error: error instanceof BodyTooLarge ? 'request exceeds 1 KiB' : 'request body could not be read' },
    });
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
  send(response, result);
}
