import type { RequestItem } from '../../types';
export interface RequestResponse {
  id:string; type:RequestItem['type']; reason:string; status:RequestItem['status'];
  submittedAt:string|null; emergency?:boolean; creatorName?:string;
  decision?:RequestItem['decision'];
  approval?:RequestItem['approval'];
  approvalHistory?:RequestItem['approvalHistory'];
  cancellationReason?:string|null;
  creatorId?:string; departmentId?:string; departmentName?:string; targetAssetCode?:string; version?:number;
  targetAssetId?:string|null; policyVersionId?:string|null;
  parameters?:Record<string, unknown>;
}

export interface DraftFields {
  type: RequestItem['type'];
  targetAssetId?: string;
  policyVersionId?: string;
  reason: string;
  emergency: boolean;
  parameters: Record<string, unknown>;
}

export function draftFields(row: RequestResponse): DraftFields {
  return {
    type: row.type, targetAssetId: row.targetAssetId ?? undefined, policyVersionId: row.policyVersionId ?? undefined,
    reason: row.reason, emergency: !!row.emergency, parameters: row.parameters ?? {},
  };
}

export function sameDraft(left: DraftFields, right: DraftFields) {
  const keys = Object.keys(left.parameters);
  return left.type === right.type && left.targetAssetId === right.targetAssetId &&
    left.policyVersionId === right.policyVersionId && left.reason.trim() === right.reason.trim() &&
    left.emergency === right.emergency && keys.length === Object.keys(right.parameters).length &&
    keys.every(key => left.parameters[key] === right.parameters[key]);
}
