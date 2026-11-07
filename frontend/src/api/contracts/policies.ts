export interface PolicyResponse {
  id:string; policyId?:string; code:string; name:string; version:number;
  configuration:Record<string,unknown>;
}

export interface PolicyVersion {
  id: string;
  version: number;
  configuration: PolicyResponse['configuration'];
  effectiveFrom: string;
}

export interface AdminPolicy {
  id: string;
  code: string;
  name: string;
  active: boolean;
  latest: PolicyVersion | null;
  effectiveVersion: number | null;
  effectiveFrom: string | null;
}

export type PolicyAlgorithm = 'RSA' | 'ECDSA' | 'ED25519' | 'AES';

export interface PolicyConfigurationInput {
  algorithm?: PolicyAlgorithm;
  certificateProfile?: 'TLS_SERVER';
  minimumKeySize?: number;
  maximumValidityDays: number;
  warningDays: number[];
}
