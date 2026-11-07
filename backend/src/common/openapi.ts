import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { REFRESH_COOKIE } from '../auth/auth-cookie';

const requestId = { type: 'string', description: 'Mã truy vết do máy chủ tạo, trùng với x-request-id.' };
const traceHeader = { 'x-request-id': { schema: requestId } };
const timestamp = { type: 'string', format: 'date-time' };
const uuid = { type: 'string', format: 'uuid' };
const boolean = { type: 'boolean' };
const binaryFilter = { type: 'string', enum: ['true', 'false'] };
const search = { type: 'string', maxLength: 100 };

const pageNumber = (maximum: number) => ({ type: 'integer', minimum: 1, maximum });
const pagination = (maximum = 100) => ({ page: pageNumber(1_000_000), pageSize: pageNumber(maximum) });
const listQueries: Record<string, Record<string, SchemaObject>> = {
  '/api/v1/assets': {
    ...pagination(), search, approvalScope: binaryFilter, eligible: { ...binaryFilter, description: 'true: tài sản có thể gia hạn hoặc thu hồi với provider đang cấu hình.' },
    status: { type: 'string', enum: ['REGISTERED', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'REVOKED', 'SUPERSEDED'] },
  },
  '/api/v1/assets/{id}/history': pagination(50),
  '/api/v1/requests': {
    ...pagination(), search, emergency: binaryFilter, excludePending: binaryFilter, approvalScope: binaryFilter,
    departmentId: { ...uuid, description: 'Lọc theo đơn vị trong phạm vi người dùng được phép xem.' },
    from: { ...timestamp, description: 'Thời điểm gửi từ mốc này, bao gồm mốc. Dùng múi giờ rõ ràng, tối đa ba chữ số phần giây.' },
    to: { ...timestamp, description: 'Thời điểm gửi đến mốc này, bao gồm mốc. Dùng múi giờ rõ ràng, tối đa ba chữ số phần giây.' },
    status: { type: 'string', enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED'] },
    type: { type: 'string', enum: ['CREATE', 'RENEW', 'REVOKE'] },
  },
  '/api/v1/users': { ...pagination(), search, status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'LOCKED'] } },
  '/api/v1/departments': { ...pagination(), search, active: binaryFilter },
  '/api/v1/notifications': { ...pagination(), read: binaryFilter },
  '/api/v1/notifications/delivery-issues': {
    ...pagination(), status: { type: 'string', enum: ['FAILED', 'RECONCILIATION_REQUIRED'] },
  },
  '/api/v1/audit-logs': {
    ...pagination(), search, actor: search, action: search, entity: search, from: timestamp, to: timestamp,
    outcome: { type: 'string', enum: ['SUCCESS', 'FAILED', 'DENIED'] }, requestId: uuid,
    limit: { ...pageNumber(200), description: 'Chỉ dùng cho danh sách tương thích cũ khi không có tham số khác.' },
  },
};

function object(properties: NonNullable<SchemaObject['properties']>, required = Object.keys(properties)): SchemaObject {
  return { type: 'object', properties, required };
}

const authUser = object({
  id: uuid,
  email: { type: 'string', format: 'email' },
  displayName: { type: 'string' },
  departmentId: uuid,
  departmentName: { type: 'string' },
  tokenVersion: { type: 'integer' },
  roles: { type: 'array', items: { type: 'string', enum: ['USER', 'APPROVER', 'ADMIN'] } },
  approverDepartmentIds: { type: 'array', items: uuid },
  mustChangePassword: boolean,
  accountActionsEnabled: boolean,
  signInMethod: { type: 'string', enum: ['SSO'] },
}, ['id', 'email', 'displayName', 'departmentId', 'tokenVersion', 'roles', 'approverDepartmentIds', 'mustChangePassword']);
const userRef = { $ref: '#/components/schemas/CryptaAuthUser' };
const accessSession = object({
  accessToken: { type: 'string', description: 'JWT dùng trong Authorization: Bearer. Giữ như thông tin bí mật.' },
  tokenType: { type: 'string', enum: ['Bearer'] },
  expiresIn: { type: 'string', description: 'Thời hạn JWT theo cấu hình, ví dụ 15m.' },
  user: userRef,
});
const changedPassword = object({ changed: boolean, loginRequired: boolean });
const live = object({ status: { type: 'string', enum: ['ok'] }, timestamp });
const ready = object({ ...live.properties, database: { type: 'string', enum: ['connected'] } });
const items = { type: 'array', items: { type: 'object' } };
const pageResult = object({ items, total: { type: 'integer', minimum: 0 }, page: pageNumber(1_000_000), pageSize: pageNumber(100) });
const legacyListResult = { oneOf: [items, pageResult], description: 'Mảng tương thích cũ khi không truyền tham số lọc hoặc phân trang. Dùng page=1 để yêu cầu kết quả phân trang.' };
const documentedReads: Record<string, SchemaObject | typeof userRef> = {
  '/api/v1/auth/account-actions': object({ enabled: boolean }),
  '/api/v1/auth/oidc/status': object({ enabled: boolean }),
  '/api/v1/auth/me': userRef,
  '/api/v1/health/live': live,
  '/api/v1/health/ready': ready,
  '/api/v1/health': ready,
  '/api/v1/assets': legacyListResult,
  '/api/v1/requests': legacyListResult,
  '/api/v1/users': legacyListResult,
  '/api/v1/notifications': legacyListResult,
  '/api/v1/audit-logs': legacyListResult,
  '/api/v1/audit-logs/{id}': object({
    id: { type: 'string', pattern: '^[1-9][0-9]*$' }, action: { type: 'string' }, entityType: { type: 'string' },
    entityId: { type: 'string', nullable: true }, outcome: { type: 'string', enum: ['SUCCESS', 'FAILED', 'DENIED'] },
    occurredAt: timestamp, actorName: { type: 'string' }, requestId: { ...uuid, nullable: true }, correlationId: requestId,
    changes: { type: 'array', items: object({ field: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' } }, ['field', 'after']) },
    related: { ...object({ kind: { type: 'string', enum: ['USER', 'ASSET'] }, id: uuid }), nullable: true },
  }, ['id', 'action', 'entityType', 'entityId', 'outcome', 'occurredAt', 'actorName', 'requestId', 'changes', 'related']),
  '/api/v1/departments': pageResult,
  '/api/v1/notifications/delivery-issues': pageResult,
  '/api/v1/operations/provider-issues': pageResult,
};
const documentedWrites: Record<string, SchemaObject> = {
  '/api/v1/auth/login': accessSession,
  '/api/v1/auth/refresh': accessSession,
  '/api/v1/auth/logout': object({ loggedOut: boolean, redirect: { type: 'string', format: 'uri' } }, ['loggedOut']),
  '/api/v1/auth/oidc/start': object({ redirect: { type: 'string', format: 'uri' } }),
  '/api/v1/auth/oidc/backchannel': object({ loggedOut: boolean }),
  '/api/v1/auth/change-password': changedPassword,
  '/api/v1/auth/password-reset': object({ accepted: boolean }),
  '/api/v1/auth/password-reset/complete': changedPassword,
  '/api/v1/auth/invitation/accept': changedPassword,
};

export function createCryptaOpenApi(app: INestApplication) {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Crypta API')
    .setDescription('API quản lý vòng đời khóa mã hóa và chứng thư số. Dữ liệu tài sản là metadata và tham chiếu provider.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addBearerAuth({ type: 'http', bearerFormat: '64 lowercase hexadecimal characters', description: 'Token giám sát riêng của môi trường.' }, 'monitorToken')
    .addCookieAuth(REFRESH_COOKIE, { type: 'apiKey', description: 'Cookie HttpOnly do đăng nhập hoặc làm mới phiên cấp.' }, 'refreshCookie')
    .build());
  const components = document.components ??= {};
  const schemas = components.schemas ??= {};
  schemas.CryptaAuthUser = authUser;
  schemas.CryptaApiError = object({
    error: object({
      code: { type: 'string', description: 'Mã lỗi nghiệp vụ hoặc HTTP_<status>.' },
      message: { type: 'string' },
      details: { description: 'Chi tiết tùy mã lỗi. Mặc định là mảng rỗng.' },
    }),
    requestId,
    timestamp,
    path: { type: 'string' },
  });
  (components.responses ??= {}).CryptaError = {
    description: 'Lỗi API. Dùng mã HTTP, error.code và requestId để xử lý và truy vết.',
    headers: traceHeader,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/CryptaApiError' } } },
  };

  for (const [path, operations] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const) {
      const operation = operations[method];
      if (!operation) continue;
      if (method === 'get' && listQueries[path]) {
        const parameters = operation.parameters ??= [];
        for (const [name, schema] of Object.entries(listQueries[path])) {
          parameters.push({ name, in: 'query', required: false, schema });
        }
      }
      if (path === '/api/v1/operations/signals') {
        operation.parameters = operation.parameters?.filter(parameter => '$ref' in parameter || parameter.in !== 'header' || parameter.name.toLowerCase() !== 'authorization');
      }
      operation.responses.default ??= { $ref: '#/components/responses/CryptaError' };
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!response || '$ref' in response || !/^[24-5]\d\d$/.test(status)) continue;
        response.headers = { ...traceHeader, ...response.headers };
        if (response.content || status === '204') continue;
        if (status.startsWith('2')) {
          response.description ||= 'Thao tác thành công.';
          const data = (method === 'get' ? documentedReads[path] : documentedWrites[path])
            ?? { description: 'Dữ liệu JSON của thao tác.' };
          response.content = { 'application/json': { schema: object({ data, requestId }) } };
        } else {
          response.content = { 'application/json': { schema: { $ref: '#/components/schemas/CryptaApiError' } } };
        }
      }
    }
  }
  return document;
}
