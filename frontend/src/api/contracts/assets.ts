import type { AssetStatus } from '../../types';
import type { PageResponse } from './page';

// Wire metadata; dates are ISO strings before the presentation mapper formats them.
export interface AssetResponse {
  id:string; code:string; purpose:string; type:'KEY'|'CERTIFICATE'; status:AssetStatus;
  expiresAt:string; validFrom?:string; policyVersionId?:string; policyVersion?:number; version?:number;
  algorithm?:string|null; keySize?:number|null; providerReference?:string|null; providerMode?:'MOCK'|'HTTP'|null;
  publicKeyFingerprint?:string|null; fingerprint?:string|null;
  ownerId?:string; departmentId?:string; ownerName?:string; departmentName?:string; policyCode?:string;
}
export interface AssetHistoryEvent {
  id:string; action:string; occurredAt:string; actorName:string; outcome:string; requestId:string|null;
}
export interface AssetHistoryResponse extends PageResponse<AssetHistoryEvent> {
  lineage:{replaces:string|null; replacedBy:string[]; assets?:Array<{id:string;code:string;relation:'predecessor'|'successor'}>};
}
