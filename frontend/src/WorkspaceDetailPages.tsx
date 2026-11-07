import { FileText,Fingerprint,KeyRound,RotateCw,ShieldAlert,X,XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { AssetHistory } from './AssetHistory';
import { StatusPill,assetStatus,requestStatus } from './WorkspaceUi';
import type { Asset,RequestItem,RequestStatus } from './types';
import { schedulePageTitleFocus } from './pageFocus';
export function AssetDetailPage({ asset, canRequest, canOpenRequests=false, onClose, onRenew, onRevoke, historyRevision=0 }: { asset: Asset; canRequest: boolean; canOpenRequests?:boolean; onClose: () => void; onRenew: () => void; onRevoke: () => void; historyRevision?:number }) {
  const canManage = canRequest && (asset.status === 'ACTIVE' || asset.status === 'EXPIRING_SOON');
  useEffect(()=>schedulePageTitleFocus(),[asset.id]);

  return <>
    <section className="asset-detail-page" aria-labelledby="page-title">
      <div className="drawer-header">
        <div className="drawer-title"><span className="asset-type-icon"><KeyRound size={19} /></span><div><p>{asset.code}</p><h1 id="page-title" tabIndex={-1}>{asset.name}</h1></div></div>
        <button className="icon-button" onClick={onClose} aria-label="Về danh sách"><X size={20} /></button>
      </div>
      <div className="drawer-body">
        <div className="drawer-status"><StatusPill {...assetStatus[asset.status]} /><span>{asset.ownerName ? `${asset.ownerName} · ${asset.departmentName ?? 'Chưa có phòng ban'}` : 'Metadata từ hệ thống'}</span></div>
        <dl className="detail-grid">
          <div><dt>Loại tài sản</dt><dd>{asset.type === 'KEY' ? 'Khóa mã hóa' : 'Chứng thư số'}</dd></div>
          <div><dt>Thuật toán</dt><dd>{asset.algorithm}</dd></div>
          <div><dt>Ngày hết hạn</dt><dd>{asset.expiresAt}</dd></div>
          <div><dt>Nhà cung cấp</dt><dd>{asset.provider}</dd></div>
        </dl>
        <div className="detail-block"><span>Mục đích sử dụng</span><p>{asset.purpose}</p></div>
        <div className="detail-block"><span>Fingerprint công khai</span><code><Fingerprint size={15} />{asset.fingerprint}</code></div>
        <div className="mini-timeline">
          <h3>Vòng đời tài sản</h3>
          <ol><li className="done"><span /><div><strong>Được cấp phát</strong><small>{asset.validFrom ?? 'Chưa ghi nhận ngày hiệu lực'} · {asset.provider}</small></div></li><li className="done"><span /><div><strong>Chính sách đang áp dụng</strong><small>{asset.policyCode ?? 'Chưa có mã chính sách'}{asset.policyVersion ? ` · v${asset.policyVersion}` : ''}</small></div></li>{asset.status === 'REVOKED' ? <li className="done"><span /><div><strong>Đã thu hồi</strong><small>Thời điểm và người thực hiện được lưu trong Audit Log.</small></div></li> : <li><span /><div><strong>Hết hạn dự kiến</strong><small>{asset.expiresAt}</small></div></li>}</ol>
        </div>
        <AssetHistory id={asset.id} revision={historyRevision} version={asset.version} canOpenRequests={canOpenRequests}/>
        {!['ACTIVE','EXPIRING_SOON'].includes(asset.status) && <div className="inline-alert inline-alert-neutral"><ShieldAlert size={19} /><div><strong>Vòng đời đã kết thúc</strong><p>Tài sản đã thu hồi hoặc thay thế không thể gia hạn hay kích hoạt lại. Lịch sử vẫn được giữ để kiểm toán.</p></div></div>}
      </div>
      <div className="drawer-footer">
        <button className="quiet-button" onClick={onClose}>Về danh sách</button>
        {canManage && <button className="danger-quiet-button" onClick={onRevoke}><XCircle size={17} /> Thu hồi</button>}
        {canManage && <button className="primary-button" onClick={onRenew}><RotateCw size={17} /> Yêu cầu gia hạn</button>}
      </div>
    </section>
  </>;
}

const executionSteps: Partial<Record<RequestStatus, string>> = {
  APPROVED: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  COMPLETED: 'Đã hoàn tất',
  FAILED: 'Xử lý lỗi',
  RECONCILIATION_REQUIRED: 'Cần đối soát',
};
const decisionTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function RequestDetailPage({ request, onClose, onDecision, onEdit, onCancel }: {
  request: RequestItem; onClose: () => void; onDecision?: (action:'APPROVE'|'REJECT')=>void;
  onEdit?:()=>void;onCancel?:()=>void;
}) {
  useEffect(()=>schedulePageTitleFocus(),[request.id]);
  const beforeSubmission = request.status === 'DRAFT' || request.submitted === false;
  const cancelled = request.status === 'CANCELLED';
  const pending = request.status === 'PENDING';
  const rejected = request.status === 'REJECTED';
  const approverName = request.decision?.approverName ?? request.approver;
  const execution = executionSteps[request.status];

  return <>
    <section className="asset-detail-page" aria-labelledby="page-title">
      <div className="drawer-header">
        <div className="drawer-title"><span className="asset-type-icon"><FileText size={19} /></span><div><p>{request.id}</p><h1 id="page-title" tabIndex={-1}>{request.subject}</h1></div></div>
        <button className="icon-button" onClick={onClose} aria-label="Về danh sách"><X size={20} /></button>
      </div>
      <div className="drawer-body">
        <div className="drawer-status"><StatusPill {...requestStatus[request.status]} /><span>{request.submittedAt}</span></div>
        <dl className="detail-grid">
          <div><dt>Loại yêu cầu</dt><dd>{request.type === 'CREATE' ? 'Cấp phát mới' : request.type === 'RENEW' ? 'Gia hạn' : 'Thu hồi'}</dd></div>
          <div><dt>Người phê duyệt</dt><dd>{beforeSubmission ? 'Chưa gửi duyệt' : approverName ?? (cancelled ? 'Đã dừng phê duyệt' : pending ? 'Đang chờ phê duyệt' : 'Chưa ghi nhận')}</dd></div>
          {cancelled && request.cancellationReason && <div><dt>Lý do hủy</dt><dd>{request.cancellationReason}</dd></div>}
        </dl>
        {request.decision?.comment && <div className="detail-block request-decision-note"><span>{rejected ? 'Lý do từ chối' : 'Ghi chú quyết định'}</span><p>{request.decision.comment}</p></div>}
        {request.emergency && !beforeSubmission && <div className="inline-alert inline-alert-danger"><ShieldAlert size={19} /><div><strong>Yêu cầu khẩn cấp</strong><p>Yêu cầu được ưu tiên xử lý theo mức khẩn cấp đã gửi.</p></div></div>}
        {request.status === 'RECONCILIATION_REQUIRED' && <div className="inline-alert inline-alert-danger"><ShieldAlert size={19} /><div><strong>Cần đối soát với nhà cung cấp</strong><p>Hệ thống chưa xác nhận được kết quả xử lý. Quản trị viên cần kiểm tra trước khi thực hiện lại để tránh cấp phát hoặc thu hồi trùng.</p></div></div>}
        <div className="mini-timeline">
          <h3>Tiến trình xử lý</h3>
          <ol>
            <li className="done"><span /><div><strong>{beforeSubmission ? 'Đã lưu bản nháp' : 'Đã tạo yêu cầu'}</strong><small>{request.submittedAt} · {request.creatorName ?? 'Người gửi'}</small></div></li>
            {cancelled ? <li className="done"><span /><div><strong>Đã hủy yêu cầu</strong><small>Lịch sử hủy được ghi vào Audit Log</small></div></li>
              : !beforeSubmission && <>
                <li className={pending ? '' : 'done'}><span /><div><strong>{pending ? 'Chờ quyết định' : rejected ? 'Đã từ chối' : 'Đã phê duyệt'}</strong><small>{pending ? `Phạm vi phê duyệt ${request.departmentName ?? 'theo đơn vị gửi yêu cầu'}` : request.decision?.decidedAt ? <time dateTime={request.decision.decidedAt}>{decisionTime.format(new Date(request.decision.decidedAt))}</time> : 'Chưa ghi nhận thời điểm'}</small></div></li>
                {execution && <li className={request.status === 'COMPLETED' ? 'done' : ''}><span /><div><strong>{execution}</strong><small>Mọi thay đổi sẽ được ghi vào Audit Log</small></div></li>}
              </>}
          </ol>
        </div>
      </div>
      <div className="drawer-footer"><button className="quiet-button" onClick={onClose}>Về danh sách</button>
        {onCancel&&<button className="danger-quiet-button" onClick={onCancel}>Hủy yêu cầu</button>}
        {onEdit&&<button className="primary-button" onClick={onEdit}>Sửa bản nháp</button>}
        {request.status==='PENDING'&&onDecision&&<><button className="danger-quiet-button" onClick={()=>onDecision('REJECT')}>Từ chối</button><button className="primary-button" onClick={()=>onDecision('APPROVE')}>Phê duyệt</button></>}
      </div>
    </section>
  </>;
}
