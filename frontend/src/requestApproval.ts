import type { RequestItem } from './types';

export function approvalExpired(approval: RequestItem['approval']) {
  return !!approval?.deadlineAt && Date.parse(approval.deadlineAt) <= Date.now();
}

export function approvalProgressLabel(approval: RequestItem['approval']) {
  if (!approval) return 'Chờ duyệt · 0/1';
  if (approval.approved === 2) return 'Đủ hai cấp · 2/2';
  if (approvalExpired(approval)) return 'Quá hạn duyệt';
  return `Chờ cấp ${approval.approved + 1} · ${approval.approved}/2`;
}
