import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/auth-user';
import { PoliciesController, PolicyVersionDto } from '../src/policies/policies.controller';

const valid = { expectedVersion: 2, algorithm: 'RSA', minimumKeySize: 2048,
  maximumValidityDays: 3650, warningDays: [30, 7, 1] };
const admin: AuthUser = { id: 'admin', email: 'admin@example.test', displayName: 'Admin',
  departmentId: 'department', tokenVersion: 1, roles: ['ADMIN'], approverDepartmentIds: [], mustChangePassword: false };
function parse(body: Record<string, unknown>) {
  // Match the actual application boundary, rather than calling the controller
  // directly with a TypeScript cast that bypasses decorator validation.
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    .transform(body, { type: 'body', metatype: PolicyVersionDto });
}

describe('policy publication input boundary', () => {
  it.each([
    ['missing', undefined], ['null', null], ['scalar string', '7'], ['numeric strings', ['7']],
    ['fraction', [7.5]], ['zero', [0]], ['negative', [-1]], ['above maximum', [3651]],
    ['PostgreSQL integer overflow', [2147483648]], ['null element', [null]], ['object', {}],
    ['nested array', [[7]]], ['duplicate threshold', [7, 7]],
  ])('rejects %s warningDays with 400', async (_label, warningDays) => {
    const body: Record<string, unknown> = { ...valid, warningDays };
    if (warningDays === undefined) delete body.warningDays;
    await expect(parse(body)).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { name: 'empty', warningDays: [] }, { name: 'boundary', warningDays: [1, 3650] },
    { name: 'usual', warningDays: [30, 7, 1] },
  ])('preserves an allowed $name warning-day array', async ({ warningDays }) => {
    const parsed = await parse({ ...valid, warningDays });
    expect(parsed.warningDays).toEqual(warningDays);
  });

  it('rejects a supplied raw configuration instead of bypassing the named DTO fields', async () => {
    await expect(parse({ ...valid, configuration: { warning_days: ['7'] } }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejects a warning threshold above validity before acquiring a database client', async () => {
    const connect = vi.fn();
    const controller = new PoliciesController({ connect } as unknown as Pool);
    const parsed = await parse({ ...valid, maximumValidityDays: 6, warningDays: [7] });
    await expect(controller.version(admin, 'policy', parsed)).rejects.toMatchObject({
      status: 409, response: { code: 'POLICY_CONFIGURATION_INVALID' },
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
