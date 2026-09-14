export type RequestRow = {
  id: string;
  request_type: string;
  creator_id: string;
  department_id: string;
  policy_version_id: string;
  target_asset_id: string | null;
  result_asset_id: string | null;
  status: string;
  reason: string;
  emergency: boolean;
  requested_parameters: Record<string, unknown>;
  version: number;
  submitted_at: Date | string;
  completed_at: Date | string | null;
  updated_at: Date | string;
  creator_name?: string;
  department_name?: string;
  target_asset_code?: string | null;
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
  };
}
