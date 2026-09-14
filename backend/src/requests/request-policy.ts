import { ForbiddenException, ConflictException } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user';

export type DecisionTarget = { creatorId: string; departmentId: string; status: string };
export type RequestKind = 'CREATE' | 'RENEW' | 'REVOKE';

export function assertParametersMatchPolicy(parameters:Record<string,unknown>,configuration:Record<string,unknown>){const assetType=String(parameters.assetType??parameters.asset_type??'KEY');if(!['KEY','CERTIFICATE'].includes(assetType))throw new ConflictException({code:'ASSET_TYPE_INVALID',message:'Loại tài sản không hợp lệ.'});const algorithm=parameters.algorithm?String(parameters.algorithm).toUpperCase():undefined;if(algorithm&&!['RSA','ECDSA','ED25519','AES'].includes(algorithm))throw new ConflictException({code:'ALGORITHM_INVALID',message:'Thuật toán không được hỗ trợ.'});if(configuration.algorithm&&algorithm&&algorithm!==String(configuration.algorithm).toUpperCase())throw new ConflictException({code:'POLICY_ALGORITHM_MISMATCH',message:'Thuật toán không phù hợp với chính sách đã chọn.'});if(configuration.certificate_profile&&assetType!=='CERTIFICATE')throw new ConflictException({code:'POLICY_ASSET_TYPE_MISMATCH',message:'Chính sách này chỉ áp dụng cho chứng thư số.'});const keySize=parameters.keySize??parameters.key_size;if(keySize!==undefined&&(!Number.isInteger(Number(keySize))||Number(keySize)<=0))throw new ConflictException({code:'KEY_SIZE_INVALID',message:'Độ dài khóa không hợp lệ.'});if(keySize!==undefined&&configuration.minimum_key_size&&Number(keySize)<Number(configuration.minimum_key_size))throw new ConflictException({code:'POLICY_KEY_SIZE_TOO_SMALL',message:'Độ dài khóa thấp hơn mức chính sách cho phép.'});const validity=parameters.validityDays??parameters.validity_days;if(validity!==undefined&&(!Number.isInteger(Number(validity))||Number(validity)<=0))throw new ConflictException({code:'VALIDITY_INVALID',message:'Thời hạn tài sản không hợp lệ.'});if(validity!==undefined&&configuration.maximum_validity_days&&Number(validity)>Number(configuration.maximum_validity_days))throw new ConflictException({code:'POLICY_VALIDITY_EXCEEDED',message:'Thời hạn vượt quá mức chính sách cho phép.'})}

export function assertCanCreateRequest(user: AuthUser, type: RequestKind, targetAssetId?: string) {
  if (user.roles.includes('ADMIN')) {
    throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', message: 'Quản trị bảo mật không tạo yêu cầu nghiệp vụ.' });
  }
  if (type !== 'CREATE' && !targetAssetId) {
    throw new ConflictException({ code: 'TARGET_ASSET_REQUIRED', message: 'Gia hạn hoặc thu hồi phải có tài sản mục tiêu.' });
  }
  if (type === 'CREATE' && targetAssetId) {
    throw new ConflictException({ code: 'TARGET_ASSET_NOT_ALLOWED', message: 'Yêu cầu cấp mới không được có tài sản mục tiêu.' });
  }
}

export function assertAssetCanChange(asset: { ownerId: string; status: string }, userId: string) {
  if (asset.ownerId !== userId) {
    throw new ForbiddenException({ code: 'ASSET_NOT_OWNED', message: 'Bạn không có quyền thay đổi tài sản này.' });
  }
  if (!['ACTIVE', 'EXPIRING_SOON'].includes(asset.status)) {
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
