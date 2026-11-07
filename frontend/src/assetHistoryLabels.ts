const labels: Readonly<Record<string, string>> = {
  ASSET_CREATED: 'Đã cấp phát',
  ASSET_RENEWED: 'Đã gia hạn',
  ASSET_REVOKED: 'Đã thu hồi',
  ASSET_MARKED_EXPIRED: 'Đã hết hạn',
  ASSET_MARKED_EXPIRING_SOON: 'Sắp hết hạn',
  ASSET_EXPIRED: 'Đã hết hạn',
  ASSET_EXPIRING: 'Sắp hết hạn',
  REQUEST_SUBMITTED: 'Đã gửi yêu cầu',
  REQUEST_DRAFT_CREATED: 'Đã lưu bản nháp',
  REQUEST_DRAFT_UPDATED: 'Đã cập nhật bản nháp',
  REQUEST_APPROVED: 'Yêu cầu được duyệt',
  REQUEST_REJECTED: 'Yêu cầu bị từ chối',
  REQUEST_CANCELLED: 'Yêu cầu đã hủy',
  REQUEST_RECONCILIATION_REQUIRED: 'Cần đối soát kết quả xử lý',
  PROVIDER_RETRY_SCHEDULED: 'Đã lên lịch thử lại',
  PROVIDER_REQUEST_ABANDONED: 'Đã đóng yêu cầu do lỗi xử lý',
  PROVIDER_RESULT_CONFIRMED: 'Đã áp dụng biên nhận provider',
  PROVIDER_DISPATCH_STARTED: 'Bắt đầu gửi đến provider',
  PROVIDER_RESULT_RECORDED: 'Đã nhận kết quả provider',
};

export function assetHistoryLabel(action: string) {
  return Object.hasOwn(labels, action) ? labels[action] : action;
}
