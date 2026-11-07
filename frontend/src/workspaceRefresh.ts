export type WorkspaceResource='summary'|'notifications'|'dashboard'|'policies'|'users'|'access'|'assets'|'requests'|'audit'|'email'|'providerRecovery';
export type ResourceRevisions=Record<WorkspaceResource,number>;
export const initialRevisions:ResourceRevisions={summary:0,notifications:0,dashboard:0,policies:0,users:0,access:0,assets:0,requests:0,audit:0,email:0,providerRecovery:0};
export const mutationResources={
  request:['requests','summary','dashboard','notifications','audit'],
  decision:['requests','assets','summary','dashboard','notifications','audit'],
  user:['users','access','summary','dashboard','audit'],
  policy:['policies','dashboard','audit'],
  providerRecovery:['providerRecovery','requests','assets','summary','dashboard','audit','notifications','email'],
  notification:['notifications'],
} as const satisfies Record<string,readonly WorkspaceResource[]>;
