import React, { useRef } from 'react';
import { FileText, ShieldAlert, X } from 'lucide-react';
import type { RequestItem, RequestStatus } from '../types';
import { StatusPill } from './StatusPill';
import { useDialogBehavior } from './useDialogBehavior';

export const requestStatus: Record<RequestStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  PROCESSING: { label: 'Đang xử lý', tone: 'warning' },
  COMPLETED: { label: 'Hoàn tất', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  FAILED: { label: 'Xử lý lỗi', tone: 'danger' },
  CANCELLED: { label: 'Đã hủy', tone: 'neutral' },
};

export function RequestDrawer({ request, onClose }: { request: RequestItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogBehavior(dialogRef, closeRef, onClose);

  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Đóng chi tiết yêu cầu" />
      <aside ref={dialogRef} className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="request-drawer-title">
        <div className="drawer-header">
          <div className="drawer-title">
            <span className="asset-type-icon"><FileText size={19} /></span>
            <div>
              <p>{request.id}</p>
              <h2 id="request-drawer-title">{request.subject}</h2>
            </div>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-status">
            <StatusPill {...requestStatus[request.status]} />
            <span>{request.submittedAt}</span>
          </div>
          <dl className="detail-grid">
            <div><dt>Loại yêu cầu</dt><dd>{request.type === 'CREATE' ? 'Cấp phát mới' : request.type === 'RENEW' ? 'Gia hạn' : 'Thu hồi'}</dd></div>
            <div><dt>Người phê duyệt</dt><dd>{request.approver ?? 'Đang chờ phân công'}</dd></div>
          </dl>
          {request.emergency && (
            <div className="inline-alert inline-alert-danger">
              <ShieldAlert size={19} />
              <div>
                <strong>Yêu cầu khẩn cấp</strong>
                <p>Yêu cầu liên quan đến thiết bị thất lạc và đã được ưu tiên xử lý.</p>
              </div>
            </div>
          )}
          <div className="mini-timeline">
            <h3>Tiến trình xử lý</h3>
            <ol>
              <li className="done"><span /><div><strong>Đã tạo yêu cầu</strong><small>{request.submittedAt} · {request.creatorName ?? 'Người dùng'}</small></div></li>
              <li className={request.status === 'PENDING' ? '' : 'done'}>
                <span />
                <div>
                  <strong>{request.status === 'PENDING' ? 'Đang chờ phê duyệt' : 'Đã có quyết định'}</strong>
                  <small>{request.status === 'PENDING' ? 'Người phê duyệt phạm vi đã được thông báo' : request.approver ?? 'Hệ thống'}</small>
                </div>
              </li>
              <li className={request.status === 'COMPLETED' ? 'done' : ''}>
                <span />
                <div>
                  <strong>{request.status === 'COMPLETED' ? 'Đã hoàn tất' : 'Chờ kết quả xử lý'}</strong>
                  <small>Mọi thay đổi sẽ được ghi vào Audit Log</small>
                </div>
              </li>
            </ol>
          </div>
        </div>
        <div className="drawer-footer">
          <button className="quiet-button" onClick={onClose}>Đóng</button>
        </div>
      </aside>
    </>
  );
}
