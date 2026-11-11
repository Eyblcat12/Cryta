export type RequestRow = {
  id: string;
  request_type: 'CREATE' | 'RENEW' | 'REVOKE';
  creator_id: string;
  department_id: string;
  policy_version_id: string | null;
  target_asset_id: string | null;
  result_asset_id: string | null;
  status: string;
  reason: string;
  emergency: boolean;
  requested_parameters: Record<string, unknown>;
  version: number;
  submitted_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
  creator_name?: string;
  department_name?: string;
  target_asset_code?: string | null;
  cancellation_reason?: string | null;
  approval_levels?: 1 | 2;
  approved_levels?: number;
  approval_deadline_at?: Date | null;
  first_approver_id?: string | null;
};

export function presentRequest(row: RequestRow) {
  return {
    id: row.id,
    type: row.request_type,
    creatorId: row.creator_id,
    departmentId: row.department_id,
    policyVersionId: row.policy_version_id,
    targetAssetId: row.target_asset_id,
    resultAssetId: row.result_asset_id,
    status: row.status,
    reason: row.reason,
    emergency: row.emergency,
    parameters: row.requested_parameters,
    version: row.version,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    creatorName: row.creator_name,
    departmentName: row.department_name,
    targetAssetCode: row.target_asset_code,
    cancellationReason: row.cancellation_reason ?? null,
    ...(row.approval_levels === 2 && { approval: {
      levels: 2, approved: row.approved_levels ?? 0, deadlineAt: row.approval_deadline_at ?? null,
      firstApproverId: row.first_approver_id ?? null,
    } }),
  };
}
