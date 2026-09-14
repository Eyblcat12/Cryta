import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/common/auth-user';
import { assertAssetCanChange, assertCanCreateRequest, assertCanDecide, assertParametersMatchPolicy } from '../src/requests/request-policy';

const approver: AuthUser = {
  id: 'approver-1', email: 'approver@example.test', displayName: 'Approver', departmentId: 'it',
  tokenVersion: 1, roles: ['APPROVER'], approverDepartmentIds: ['it'],
  mustChangePassword: false,
};

describe('request decision policy', () => {
  it('allows a scoped approver who is not the creator', () => {
    expect(() => assertCanDecide(approver, { creatorId: 'user-1', departmentId: 'it', status: 'PENDING' })).not.toThrow();
  });

  it('blocks self approval', () => {
    expect(() => assertCanDecide(approver, { creatorId: approver.id, departmentId: 'it', status: 'PENDING' })).toThrowError(/tự phê duyệt/);
  });

  it('blocks requests outside assigned department scope', () => {
    expect(() => assertCanDecide(approver, { creatorId: 'user-1', departmentId: 'finance', status: 'PENDING' })).toThrowError(/phạm vi/);
  });

  it('blocks security admins from deciding', () => {
    expect(() => assertCanDecide({ ...approver, roles: ['ADMIN'] }, { creatorId: 'user-1', departmentId: 'it', status: 'PENDING' })).toThrowError(/người phê duyệt/);
  });

  it('rejects a stale decision', () => {
    expect(() => assertCanDecide(approver, { creatorId: 'user-1', departmentId: 'it', status: 'APPROVED' })).toThrowError(/đã được xử lý/);
  });
});

describe('request creation policy', () => {
  it('requires a target for renew and revoke', () => {
    expect(() => assertCanCreateRequest({ ...approver, roles: ['USER'] }, 'RENEW')).toThrowError(/tài sản mục tiêu/);
  });

  it('forbids a target for create', () => {
    expect(() => assertCanCreateRequest({ ...approver, roles: ['USER'] }, 'CREATE', 'asset-1')).toThrowError(/cấp mới/);
  });

  it('blocks admins from creating business requests', () => {
    expect(() => assertCanCreateRequest({ ...approver, roles: ['ADMIN'] }, 'CREATE')).toThrowError(/Quản trị bảo mật/);
  });

  it('allows only the owner to change an active asset', () => {
    expect(() => assertAssetCanChange({ ownerId: 'user-2', status: 'ACTIVE' }, 'user-1')).toThrowError(/không có quyền/);
  });

  it('blocks changing an ended asset', () => {
    expect(() => assertAssetCanChange({ ownerId: 'user-1', status: 'REVOKED' }, 'user-1')).toThrowError(/Trạng thái hiện tại/);
  });
});

describe('request parameter policy',()=>{
  it('accepts parameters within policy bounds',()=>{expect(()=>assertParametersMatchPolicy({assetType:'KEY',algorithm:'RSA',keySize:3072,validityDays:90},{algorithm:'RSA',minimum_key_size:2048,maximum_validity_days:365})).not.toThrow()});
  it('rejects a weak key size',()=>{expect(()=>assertParametersMatchPolicy({assetType:'KEY',keySize:1024},{minimum_key_size:2048})).toThrowError(/thấp hơn/)});
  it('rejects excessive validity',()=>{expect(()=>assertParametersMatchPolicy({assetType:'KEY',validityDays:730},{maximum_validity_days:365})).toThrowError(/vượt quá/)});
  it('rejects using a certificate-only policy for a key',()=>{expect(()=>assertParametersMatchPolicy({assetType:'KEY'},{certificate_profile:'TLS_SERVER'})).toThrowError(/chứng thư số/)});
});
