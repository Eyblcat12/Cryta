import React, { useEffect, useRef } from 'react';
import { Bell, Check, AlertTriangle, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';

export interface NotificationItem {
  id: string;
  type: string;
  assetId?: string | null;
  requestId?: string | null;
  assetCode?: string | null;
  description?: string | null;
  createdAt: string;
  readAt?: string | null;
}

interface NotificationPopoverProps {
  notifications: NotificationItem[];
  unreadCount: number;
  onMarkAllRead: () => Promise<void>;
  onClose: () => void;
  onSelectNotification?: (item: NotificationItem) => void;
}

export function NotificationPopover({
  notifications,
  unreadCount,
  onMarkAllRead,
  onClose,
  onSelectNotification,
}: NotificationPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't close if clicking within the popover
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Use mousedown with capture false
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'REQUEST_APPROVED':
        return <CheckCircle2 size={16} />;
      case 'REQUEST_REJECTED':
        return <XCircle size={16} />;
      case 'ASSET_EXPIRING':
        return <AlertTriangle size={16} />;
      case 'ASSET_EXPIRED':
        return <AlertTriangle size={16} />;
      case 'ASSET_REVOKED':
        return <ShieldAlert size={16} />;
      case 'REQUEST_SUBMITTED':
      default:
        return <Bell size={16} />;
    }
  };

  const getNotificationTitle = (type: string) => {
    switch (type) {
      case 'REQUEST_APPROVED':
        return 'Yêu cầu đã được phê duyệt';
      case 'REQUEST_REJECTED':
        return 'Yêu cầu bị từ chối';
      case 'REQUEST_SUBMITTED':
        return 'Yêu cầu mới cần phê duyệt';
      case 'ASSET_EXPIRING':
        return 'Tài sản sắp hết hạn';
      case 'ASSET_EXPIRED':
        return 'Tài sản đã hết hạn';
      case 'ASSET_REVOKED':
        return 'Tài sản đã bị thu hồi';
      default:
        return 'Thông báo hệ thống';
    }
  };

  const formatTimestamp = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  return (
    <div ref={popoverRef} className="notification-popover" role="dialog" aria-label="Bảng thông báo">
      <div className="notification-popover-header">
        <div className="notification-popover-title">
          <strong>Thông báo</strong>
          {unreadCount > 0 && <span className="notification-count-badge">{unreadCount} mới</span>}
        </div>
        <button
          type="button"
          className="text-button mark-all-read-btn"
          disabled={unreadCount === 0}
          onClick={async (e) => {
            e.stopPropagation();
            await onMarkAllRead();
          }}
          title="Đánh dấu tất cả là đã đọc"
        >
          <Check size={14} /> Đánh dấu đã đọc
        </button>
      </div>

      <div className="notification-popover-body">
        {notifications.length > 0 ? (
          notifications.slice(0, 15).map((item) => (
            <div
              key={item.id}
              className={`notification-popover-item ${!item.readAt ? 'is-unread' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelectNotification?.(item);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onSelectNotification?.(item);
                }
              }}
            >
              <span className={`notification-icon-wrapper notification-icon-${item.type.toLowerCase().replace(/_/g, '-')}`}>
                {getNotificationIcon(item.type)}
              </span>
              <div className="notification-item-content">
                <div className="notification-item-top">
                  <strong className="notification-item-title">{getNotificationTitle(item.type)}</strong>
                  <time className="notification-item-time">{formatTimestamp(item.createdAt)}</time>
                </div>
                <p className="notification-item-desc">
                  {item.assetCode
                    ? `Mã tài sản: ${item.assetCode}`
                    : item.description
                    ? item.description
                    : item.requestId
                    ? `Mã yêu cầu: #${item.requestId.slice(0, 8)}`
                    : 'Cập nhật hệ thống'}
                </p>
              </div>
              {!item.readAt && <span className="notification-unread-dot" title="Chưa đọc" />}
            </div>
          ))
        ) : (
          <div className="notification-empty-state">
            <Bell size={28} />
            <p><strong>Không có thông báo nào</strong></p>
            <small>Cập nhật quan trọng về tài sản và phê duyệt sẽ hiển thị tại đây.</small>
          </div>
        )}
      </div>
    </div>
  );
}
