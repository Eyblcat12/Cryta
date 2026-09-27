import React, { useRef } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useDialogBehavior } from './useDialogBehavior';

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogBehavior(dialogRef, closeRef, onClose);

  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} aria-label="Đóng trợ giúp" />
      <section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header>
          <div>
            <p className="eyebrow">Hướng dẫn nhanh</p>
            <h2 id="help-title">Sử dụng Crypta an toàn</h2>
            <span>Các bước chính cho quy trình tài sản mật mã.</span>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <div className="help-content">
          <div>
            <strong>Nhân viên</strong>
            <p>Tạo yêu cầu cấp mới, gia hạn hoặc thu hồi. Không nhập private key, token hay mật khẩu vào phần lý do.</p>
          </div>
          <div>
            <strong>Người phê duyệt</strong>
            <p>Kiểm tra người gửi, phạm vi, tài sản và lý do. Nếu dữ liệu đã thay đổi, tải lại trước khi quyết định.</p>
          </div>
          <div>
            <strong>Security Admin</strong>
            <p>Theo dõi tài sản, Audit Log, quản lý chính sách và quyền người dùng. Có quyền thu hồi khẩn cấp tài sản khi có sự cố.</p>
          </div>
          <div className="inline-alert">
            <ShieldCheck size={18} />
            <div>
              <strong>Khi cần hỗ trợ kỹ thuật</strong>
              <p>Gửi mã request hoặc asset và thời điểm xảy ra lỗi; không gửi secret hay tệp private key.</p>
            </div>
          </div>
        </div>
        <footer>
          <button className="primary-button" onClick={onClose}>Đã hiểu</button>
        </footer>
      </section>
    </div>
  );
}
