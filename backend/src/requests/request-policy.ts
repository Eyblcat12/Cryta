import { ForbiddenException, ConflictException } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user';

export type DecisionTarget = { creatorId: string; departmentId: string; status: string };
export type RequestKind = 'CREATE' | 'RENEW' | 'REVOKE';

export type RequestParameters = {
  assetType?: 'KEY' | 'CERTIFICATE';
  algorithm?: 'RSA' | 'ECDSA' | 'ED25519' | 'AES';
  keySize?: number;
  validityDays?: number;
  usage?: string;
};

const CURVE_BITS: Record<string, number> = { 'P-256': 256, 'P-384': 384, 'P-521': 521 };

function invalidCombination(message: string): never {
  throw new ConflictException({ code: 'POLICY_PARAMETER_UNSUPPORTED', message });
}

function invalidConfiguration(): never {
  throw new ConflictException({ code: 'POLICY_CONFIGURATION_INVALID', message: 'Cấu hình phiên bản chính sách không hợp lệ.' });
}

function policyLimit(value: unknown, maximum: number) {
  if (value === undefined) return undefined;
  // Older snapshots can contain decimal strings. Reject other coercions before comparing limits.
  const limit = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum) invalidConfiguration();
  return limit;
}

export function resolveProvisionParameters(
  parameters: Record<string, unknown>,
  configuration: unknown,
  target?: { assetType: 'KEY' | 'CERTIFICATE'; algorithm?: string | null; keySize?: number | null; usage?: string | null },
) {
  const normalized = normalizeRequestParameters(parameters);
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) invalidConfiguration();
  const policy = configuration as Record<string, unknown>;
  const configuredAlgorithm = typeof policy.algorithm === 'string' ? policy.algorithm.toUpperCase() : undefined;
  if (policy.algorithm !== undefined && (!configuredAlgorithm || !['RSA', 'ECDSA', 'ED25519', 'AES'].includes(configuredAlgorithm))) invalidConfiguration();
  const certificateProfile = policy.certificate_profile;
  if (certificateProfile !== undefined && certificateProfile !== 'TLS_SERVER') invalidConfiguration();
  const curve = policy.curve;
  if (curve !== undefined && (typeof curve !== 'string' || !Object.hasOwn(CURVE_BITS, curve))) invalidConfiguration();
  const curveBits = typeof curve === 'string' ? CURVE_BITS[curve] : undefined;
  const minimumKeySize = policyLimit(policy.minimum_key_size, Number.MAX_SAFE_INTEGER);
  const maximumValidityDays = policyLimit(policy.maximum_validity_days, 3650);
  const assetType = target?.assetType ?? normalized.assetType ?? 'KEY';
  const algorithm = (normalized.algorithm ?? target?.algorithm ?? configuredAlgorithm ?? 'RSA').toUpperCase();
  const defaultBits = algorithm === 'AES' || algorithm === 'ED25519' || algorithm === 'ECDSA' ? 256 : 2048;
  const keySize = normalized.keySize ?? target?.keySize ?? minimumKeySize ?? curveBits ?? defaultBits;
  const validityDays = normalized.validityDays ?? maximumValidityDays ?? 365;
  const usage = normalized.usage ?? target?.usage ?? (algorithm === 'AES' ? 'ENCRYPTION' : 'SIGNING');
  if (normalized.assetType && normalized.assetType !== assetType) invalidCombination('Loại tài sản không khớp với tài sản hiện có.');
  if (certificateProfile && assetType !== 'CERTIFICATE') throw new ConflictException({ code: 'POLICY_ASSET_TYPE_MISMATCH', message: 'Chính sách này chỉ áp dụng cho chứng thư số.' });
  if (assetType === 'CERTIFICATE' && !certificateProfile) invalidCombination('Chứng thư số cần chính sách có hồ sơ chứng thư.');
  if (configuredAlgorithm && algorithm !== configuredAlgorithm) throw new ConflictException({ code: 'POLICY_ALGORITHM_MISMATCH', message: 'Thuật toán không phù hợp với chính sách đã chọn.' });
  if (curveBits !== undefined && algorithm !== 'ECDSA') invalidConfiguration();
  if (assetType === 'CERTIFICATE' && algorithm === 'AES') invalidCombination('AES không dùng để cấp chứng thư số.');
  if (maximumValidityDays !== undefined && validityDays > maximumValidityDays) throw new ConflictException({ code: 'POLICY_VALIDITY_EXCEEDED', message: 'Thời hạn vượt quá mức chính sách cho phép.' });
  if (!Number.isSafeInteger(validityDays) || validityDays < 1 || validityDays > 3650) invalidCombination('Thời hạn chính sách không hợp lệ.');
  if (!Number.isSafeInteger(keySize) || keySize < 1) invalidCombination('Độ dài khóa trong chính sách không hợp lệ.');
  if (minimumKeySize !== undefined && keySize < minimumKeySize) throw new ConflictException({ code: 'POLICY_KEY_SIZE_TOO_SMALL', message: 'Độ dài khóa thấp hơn mức chính sách cho phép.' });
  if (algorithm === 'RSA' && keySize < 2048) invalidCombination('RSA phải có độ dài tối thiểu 2048 bit.');
  if (algorithm === 'ECDSA' && (![256, 384, 521].includes(keySize) || (curveBits !== undefined && curveBits !== keySize))) invalidCombination('ECDSA chỉ hỗ trợ curve P-256, P-384 hoặc P-521 phù hợp độ dài khóa.');
  if (algorithm === 'ED25519' && keySize !== 256) invalidCombination('ED25519 chỉ hỗ trợ khóa 256 bit.');
  if (algorithm === 'AES' && ![128, 192, 256].includes(keySize)) invalidCombination('AES chỉ hỗ trợ khóa 128, 192 hoặc 256 bit.');
  if (!['RSA', 'ECDSA', 'ED25519', 'AES'].includes(algorithm)) invalidCombination('Thuật toán không được hỗ trợ.');
  return { assetType, algorithm, keySize, validityDays, usage };
}

export function normalizeRequestParameters(parameters: Record<string, unknown>): RequestParameters {
  const allowed = new Set(['assetType', 'asset_type', 'algorithm', 'keySize', 'key_size', 'validityDays', 'validity_days', 'usage']);
  if (Object.keys(parameters).some((key) => !allowed.has(key))) {
    throw new ConflictException({ code: 'PARAMETER_UNKNOWN', message: 'Yêu cầu có tham số không được hỗ trợ.' });
  }
  function aliased(camel: string, snake: string): unknown {
    const first = parameters[camel];
    const second = parameters[snake];
    if (first !== undefined && second !== undefined && String(first) !== String(second)) {
      throw new ConflictException({ code: 'PARAMETER_ALIAS_CONFLICT', message: `Hai cách ghi ${camel} không được có giá trị khác nhau.` });
    }
    return first ?? second;
  }
  const assetType = aliased('assetType', 'asset_type');
  const algorithm = parameters.algorithm;
  const keySize = aliased('keySize', 'key_size');
  const validityDays = aliased('validityDays', 'validity_days');
  const usage = parameters.usage;
  const normalized: RequestParameters = {};
  if (assetType !== undefined) {
    if (assetType !== 'KEY' && assetType !== 'CERTIFICATE') throw new ConflictException({ code: 'ASSET_TYPE_INVALID', message: 'Loại tài sản không hợp lệ.' });
    normalized.assetType = assetType;
  }
  if (algorithm !== undefined) {
    if (typeof algorithm !== 'string' || !['RSA', 'ECDSA', 'ED25519', 'AES'].includes(algorithm.toUpperCase())) throw new ConflictException({ code: 'ALGORITHM_INVALID', message: 'Thuật toán không được hỗ trợ.' });
    normalized.algorithm = algorithm.toUpperCase() as RequestParameters['algorithm'];
  }
  if (keySize !== undefined) {
    if (typeof keySize !== 'number' || !Number.isInteger(keySize) || keySize <= 0) throw new ConflictException({ code: 'KEY_SIZE_INVALID', message: 'Độ dài khóa không hợp lệ.' });
    normalized.keySize = keySize;
  }
  if (validityDays !== undefined) {
    if (typeof validityDays !== 'number' || !Number.isInteger(validityDays) || validityDays <= 0) throw new ConflictException({ code: 'VALIDITY_INVALID', message: 'Thời hạn tài sản không hợp lệ.' });
    normalized.validityDays = validityDays;
  }
  if (usage !== undefined) {
    if (typeof usage !== 'string' || !usage.trim() || usage.length > 100) throw new ConflictException({ code: 'USAGE_INVALID', message: 'Mục đích sử dụng khóa không hợp lệ.' });
    normalized.usage = usage.trim();
  }
  return normalized;
}

export function assertCanCreateRequest(
  user: AuthUser, type: RequestKind, targetAssetId?: string, { allowMissingTarget = false } = {},
) {
  if (user.roles.includes('ADMIN')) {
    throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', message: 'Quản trị bảo mật không tạo yêu cầu nghiệp vụ.' });
  }
  if (type !== 'CREATE' && !targetAssetId && !allowMissingTarget) {
    throw new ConflictException({ code: 'TARGET_ASSET_REQUIRED', message: 'Gia hạn hoặc thu hồi phải có tài sản mục tiêu.' });
  }
  if (type === 'CREATE' && targetAssetId) {
    throw new ConflictException({ code: 'TARGET_ASSET_NOT_ALLOWED', message: 'Yêu cầu cấp mới không được có tài sản mục tiêu.' });
  }
}

export function assertAssetCanChange(asset: { ownerId: string; status: string; expired?: boolean }, userId: string) {
  if (asset.ownerId !== userId) {
    throw new ForbiddenException({ code: 'ASSET_NOT_OWNED', message: 'Bạn không có quyền thay đổi tài sản này.' });
  }
  if (asset.expired || !['ACTIVE', 'EXPIRING_SOON'].includes(asset.status)) {
    throw new ConflictException({ code: 'INVALID_ASSET_STATE', message: 'Trạng thái hiện tại không cho phép gia hạn hoặc thu hồi.' });
  }
}

export function assertCanDecide(user: AuthUser, request: DecisionTarget) {
  if (!user.roles.includes('APPROVER')) {
    throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', message: 'Chỉ người phê duyệt mới được đưa ra quyết định.' });
  }
  if (user.roles.includes('ADMIN')) {
    throw new ForbiddenException({ code: 'SOD_ROLE_CONFLICT', message: 'Quản trị bảo mật không được phê duyệt yêu cầu nghiệp vụ.' });
  }
  if (request.creatorId === user.id) {
    throw new ForbiddenException({ code: 'SOD_VIOLATION', message: 'Người tạo không được tự phê duyệt yêu cầu.' });
  }
  if (!user.approverDepartmentIds.includes(request.departmentId)) {
    throw new ForbiddenException({ code: 'OUT_OF_SCOPE', message: 'Yêu cầu nằm ngoài phạm vi phòng ban được giao.' });
  }
  if (request.status !== 'PENDING') {
    throw new ConflictException({ code: 'REQUEST_ALREADY_DECIDED', message: 'Yêu cầu đã được xử lý bởi người khác.' });
  }
}
