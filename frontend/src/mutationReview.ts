import { api, ApiError } from './api';
import type { WorkspaceMutation } from './workspaceMutations';
import { requestStatus } from './WorkspaceUi';
export async function readMutationState(item:WorkspaceMutation,signal:AbortSignal){
  switch(item.kind){
    case 'request-create':{
      const page=await api.requestPage({page:1,pageSize:10,createdByMe:true},signal);
      return `Đã tải ${page.items.length}/${page.total} yêu cầu gần đây của bạn. Mở danh sách để đối chiếu; chưa xác định được ID của lần gửi này.`;
    }
    case 'request-draft-save':case 'request-draft-submit':case 'request-decision':case 'request-cancel':{
      try {
        const request=await api.requestDetail(item.targetId!,signal);
        const approval=request.approval?`, đã duyệt ${request.approval.approved}/${request.approval.levels} cấp`:'';
        return `Dữ liệu hiện tại: ${requestStatus[request.status].label}${approval}, phiên bản ${request.version??'chưa xác định'}.`;
      } catch (error) {
        if(item.kind==='request-draft-save'&&item.expectedVersion===undefined&&error instanceof ApiError&&error.status===404)
          return 'Chưa thấy bản nháp với mã đã dùng. Nếu lưu lại, hệ thống sẽ dùng cùng mã để tránh tạo hai bản.';
        throw error;
      }
    }
    case 'department-save':case 'department-status':{
      try{const department=await api.department(item.targetId!,signal);return `Dữ liệu hiện tại: ${department.code}, ${department.name}, ${department.active?'đang hoạt động':'ngừng hoạt động'}, phiên bản ${department.version}.`}
      catch(error){if(item.kind==='department-save'&&item.expectedVersion===undefined&&error instanceof ApiError&&error.status===404)return 'Chưa thấy đơn vị với mã đã dùng. Lưu lại sẽ dùng cùng ID để tránh tạo trùng.';throw error}
    }
    case 'user-department':case 'user-create':case 'user-invite':case 'user-invite-resend':case 'user-status':case 'user-access':{
      const findByEmail=item.kind==='user-create'||item.kind==='user-invite';
      const page=await api.userPage({page:1,pageSize:1,...(findByEmail?{email:item.email}:{userId:item.targetId})},signal);
      const user=page.items[0];
      return user?`Dữ liệu hiện tại: ${user.email}, trạng thái ${user.status}, vai trò ${user.roles.join(', ')}, đơn vị ${user.departmentName}, phiên bản ${user.version??'chưa xác định'}.`:'Chưa tìm thấy tài khoản phù hợp trong dữ liệu hiện tại.';
    }
    case 'policy-create':case 'policy-version':case 'policy-deactivate':{
      const policies=await api.adminPolicies(signal);
      const policy=policies.find(row=>item.kind==='policy-create'?row.code===item.expectedCode:row.id===item.targetId);
      if(!policy)return 'Chưa tìm thấy chính sách phù hợp trong dữ liệu hiện tại.';
      const version=policy.latest?`v${policy.latest.version}`:'chưa có';
      return `${policy.code}: ${policy.active?'đang áp dụng':'đã ngừng áp dụng'}. Phiên bản gần nhất: ${version}.`;
    }
    case 'notification-read':{
      const page=await api.notificationPage({page:1,pageSize:1,read:false},signal);
      return `Dữ liệu hiện tại: ${page.total} thông báo chưa đọc. Mở Thông báo để đối chiếu mục đã chọn.`;
    }
    case 'provider-recovery':{
      const issue=await api.providerIssue(item.targetId!,signal);
      const status=issue.status==='RETRY_SCHEDULED'?'Đang chờ thử lại':requestStatus[issue.status]?.label??issue.status;
      return `Yêu cầu hiện tại: ${status}, phiên bản ${issue.version}.`;
    }
    case 'email-test':{
      await api.emailIssuesPage({page:1,pageSize:1},signal);
      return 'Đã tải dữ liệu vận hành email. Thư gửi thử không nằm trong hàng đợi này; hãy kiểm tra hộp thư nhận hoặc log SMTP trước khi gửi lại.';
    }
    case 'email-reconciliation':case 'email-retry': {
      const delivery = await api.emailDelivery(item.targetId!, signal);
      const state = delivery.status === 'SENT' ? 'SMTP đã chấp nhận'
        : delivery.failure === 'VERIFIED_UNSENT' ? 'Đã xác minh SMTP chưa chấp nhận'
        : delivery.status === 'RECONCILIATION_REQUIRED' ? 'Vẫn cần đối soát'
        : delivery.status === 'PENDING' ? 'Đang chờ gửi' : delivery.status;
      return `Trạng thái hiện tại của email: ${state}. Lượt gửi: ${delivery.attemptCount}.`;
    }
  }
}
