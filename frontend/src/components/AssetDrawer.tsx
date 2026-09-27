import React, { useRef, useState } from 'react';
import { Fingerprint, KeyRound, RotateCw, ShieldAlert, X, XCircle } from 'lucide-react';
import type { Asset, AssetStatus } from '../types';
import { StatusPill } from './StatusPill';
import { useDialogBehavior } from './useDialogBehavior';

export const assetStatus: Record<AssetStatus, { label: string; tone: string }> = {
  ACTIVE: { label: 'Đang hoạt động', tone: 'success' },
  EXPIRING_SOON: { label: 'Sắp hết hạn', tone: 'warning' },
  EXPIRED: { label: 'Đã hết hạn', tone: 'neutral' },
  REVOKED: { label: 'Đã thu hồi', tone: 'danger' },
  SUPERSEDED: { label: 'Đã thay thế', tone: 'neutral' },
};

export function AssetDrawer({
  asset,
  onClose,
  onRenew,
  onRevoke,
  isAdmin = false,
  onEmergencyRevoke,
}: {
  asset: Asset;
  onClose: () => void;
  onRenew: () => void;
  onRevoke: () => void;
  isAdmin?: boolean;
  onEmergencyRevoke?: (assetId: string, reason: string) => Promise<void>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const canManage = asset.status === 'ACTIVE' || asset.status === 'EXPIRING_SOON';
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [busy, setBusy] = useState(false);

  useDialogBehavior(dialogRef, closeRef, onClose);

  const handleEmergencyRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onEmergencyRevoke) return;
    setBusy(true);
    try {
      await onEmergencyRevoke(asset.id, emergencyReason);
      setShowEmergencyDialog(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Đóng chi tiết tài sản" />
      <aside ref={dialogRef} className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-drawer-title">
        <div className="drawer-header">
          <div className="drawer-title">
            <span className="asset-type-icon"><KeyRound size={19} /></span>
            <div>
              <p>{asset.code}</p>
              <h2 id="asset-drawer-title">{asset.name}</h2>
            </div>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </div>

        <div className="drawer-body">
          <div className="drawer-status">
            <StatusPill {...assetStatus[asset.status]} />
            <span>{asset.ownerName ? `${asset.ownerName} · ${asset.departmentName ?? 'Chưa có phòng ban'}` : 'Metadata từ hệ thống'}</span>
          </div>
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
            <ol>
              <li className="done"><span /><div><strong>Được cấp phát</strong><small>{asset.validFrom ?? 'Chưa ghi nhận ngày hiệu lực'} · {asset.provider}</small></div></li>
              <li className="done"><span /><div><strong>Chính sách đang áp dụng</strong><small>{asset.policyCode ?? 'Chưa có mã chính sách'}{asset.version ? ` · metadata v${asset.version}` : ''}</small></div></li>
              {asset.status === 'REVOKED' ? (
                <li className="done"><span /><div><strong>Đã thu hồi</strong><small>Thời điểm và người thực hiện được lưu trong Audit Log.</small></div></li>
              ) : (
                <li><span /><div><strong>Hết hạn dự kiến</strong><small>{asset.expiresAt}</small></div></li>
              )}
            </ol>
          </div>

          {showEmergencyDialog && (
            <div className="inline-alert inline-alert-danger" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <ShieldAlert size={20} />
                <strong>Thu hồi khẩn cấp (Security Admin / CISO)</strong>
              </div>
              <p>Khóa/chứng thư sẽ bị vô hiệu hóa ngay lập tức trên toàn hệ thống mà không cần người dùng làm đơn.</p>
              <form onSubmit={handleEmergencyRevoke} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Nhập lý do thu hồi khẩn cấp..."
                  value={emergencyReason}
                  onChange={(e) => setEmergencyReason(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border-soft)' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="quiet-button" onClick={() => setShowEmergencyDialog(false)}>Hủy</button>
                  <button type="submit" disabled={busy} className="danger-button">
                    {busy ? 'Đang thu hồi...' : 'Xác nhận thu hồi ngay'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {!canManage && (
            <div className="inline-alert inline-alert-neutral">
              <ShieldAlert size={19} />
              <div>
                <strong>Vòng đời đã kết thúc</strong>
                <p>Tài sản đã thu hồi hoặc thay thế không thể gia hạn hay kích hoạt lại. Lịch sử vẫn được giữ để kiểm toán.</p>
              </div>
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="quiet-button" onClick={onClose}>Đóng</button>
          {canManage && isAdmin && !showEmergencyDialog && (
            <button className="danger-button" onClick={() => setShowEmergencyDialog(true)}>
              <ShieldAlert size={17} /> Thu hồi khẩn cấp (CISO)
            </button>
          )}
          {canManage && !isAdmin && (
            <>
              <button className="danger-quiet-button" onClick={onRevoke}><XCircle size={17} /> Thu hồi</button>
              <button className="primary-button" onClick={onRenew}><RotateCw size={17} /> Yêu cầu gia hạn</button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
