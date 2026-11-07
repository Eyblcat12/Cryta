const assert = require('node:assert/strict');
const fs = require('node:fs');

async function generateDocument() {
  process.env.JWT_ACCESS_SECRET = 'openapi-schema-test-fixture-only-0000';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { createCryptaOpenApi } = require('../dist/common/openapi');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  try {
    app.setGlobalPrefix('api/v1');
    return createCryptaOpenApi(app);
  } finally {
    await app.close();
  }
}

async function main() {
  const path = process.argv[2];
  const document = path ? JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) : await generateDocument();
  const { paths, components } = document;
  const errorResponse = '#/components/responses/CryptaError';
  const base = '/api/v1';
  let operations = 0;
  let bodies = 0;

  for (const [route, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation.responses) continue;
      operations++;
      const name = `${method.toUpperCase()} ${route}`;
      const body = operation.requestBody?.content?.['application/json'];
      if (body) {
        const ref = body.schema.$ref?.split('/').at(-1);
        const schema = ref ? components.schemas[ref] : body.schema;
        assert.ok(Object.keys(schema?.properties ?? {}).length, `${name} has a documented JSON body`);
        bodies++;
      }
      assert.equal(operation.responses.default?.$ref, errorResponse, name);
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!/^2\d\d$/.test(status) || status === '204') continue;
        assert.ok(response.headers?.['x-request-id'], `${name} documents the response correlation header`);
        assert.deepEqual(response.content?.['application/json']?.schema?.required, ['data', 'requestId'], name);
      }
    }
  }

  assert.ok(operations >= 54 && bodies >= 21, 'expected current API surface');
  assert.deepEqual(components.schemas.LoginDto.required, ['email', 'password']);
  assert.equal(components.schemas.LoginDto.properties.password.writeOnly, true);
  assert.equal(components.schemas.CompleteAccountActionDto.properties.token.writeOnly, true);
  assert.ok(components.schemas.SaveDraftDto.properties.version);
  assert.deepEqual(components.schemas.RecoveryDto.properties.action.enum, ['RETRY', 'ABANDON', 'CONFIRM']);
  assert.equal(paths[`${base}/auth/refresh`].post.security[0].refreshCookie.length, 0);
  assert.equal(components.securitySchemes.refreshCookie.name, 'crypta_refresh');
  assert.deepEqual(paths[`${base}/operations/signals`].get.security, [{ monitorToken: [] }]);
  assert.deepEqual(paths[`${base}/operations/metrics`].get.security, [{ bearer: [] }]);
  assert.deepEqual(components.schemas.CryptaApiError.required, ['error', 'requestId', 'timestamp', 'path']);
  for (const route of ['/assets', '/requests', '/users', '/notifications', '/audit-logs', '/departments']) {
    const { parameters } = paths[base + route].get;
    assert.equal(parameters.filter(p => p.in === 'query' && p.name === 'pageSize').length, 1, route);
  }
  console.log(`OpenAPI verified: ${Object.keys(paths).length} paths, ${operations} operations, ${bodies} JSON bodies`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
