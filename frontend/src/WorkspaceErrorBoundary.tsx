import { useNavigate } from 'react-router';
import { PageHeader } from './WorkspaceUi';

export function WorkspaceErrorBoundary() {
  const navigate=useNavigate();
  return <><PageHeader eyebrow="Khôi phục trang" title="Không thể hiển thị trang" description="Có lỗi khi xử lý nội dung. Bạn có thể tải lại hoặc mở một trang khác."/><div className="empty-state" role="alert"><strong>Trang chưa thể hiển thị.</strong><button className="secondary-button" onClick={()=>window.location.reload()}>Tải lại trang</button><button className="quiet-button" onClick={()=>navigate('/dashboard',{replace:true})}>Về tổng quan</button></div></>;
}
