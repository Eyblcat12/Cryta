import { api } from './api';
import { PolicyManager } from './PolicyManager';
import { ResourceRegion } from './ResourceRegion';
import { PageHeader } from './WorkspaceUi';
import { useResource } from './useResource';
import type { WorkspacePageContext } from './WorkspacePage';
import { TableSkeletonRows } from './LoadingOutline';

function PolicyOutline() {
  return <section className="content-section">
    <div className="section-heading"><div><h2>Danh sách chính sách</h2><p>Quản lý hiệu lực và lịch sử phiên bản.</p></div></div>
    <div className="table-scroll"><table className="policy-table policy-lifecycle-table">
      <thead><tr><th>Chính sách</th><th>Trạng thái</th><th>Phiên bản hiệu lực</th><th>Thao tác</th></tr></thead>
      <tbody><TableSkeletonRows rows={1} columns={4} visible/></tbody>
    </table></div>
  </section>;
}

export function PoliciesPage({ context }: { context: WorkspacePageContext }) {
  const resource = useResource(context.scope + ':admin-policies', api.adminPolicies, context.revisions.policies);
  return <>
    <PageHeader eyebrow="Quản trị cấu hình" title="Chính sách mật mã" description="Quản lý hiệu lực và lịch sử phiên bản."
      actions={<button className="secondary-button" disabled={resource.loading} onClick={resource.retry}>Làm mới chính sách</button>}/>
    <ResourceRegion resource={resource} label="Chính sách" placeholder={<PolicyOutline/>}>
      {policies => <PolicyManager policies={policies} disabled={resource.loading || !!resource.error}/>}
    </ResourceRegion>
  </>;
}
