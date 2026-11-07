export interface DepartmentResponse { id:string; code:string; name:string; active:boolean; version:number; userCount?:number; scopeCount?:number }
export interface DepartmentDetail extends DepartmentResponse { usage:{users:number;approverScopes:number;openRequests:number;activeAssets:number} }
