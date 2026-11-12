import { useCallback } from 'react';
import { useLocation,useNavigate } from 'react-router';
import { api } from './api';
import { RequestModal } from './WorkspaceDialogs';
import { PageHeader } from './WorkspaceUi';
import type { RequestType } from './WorkspaceUi';
import type { WorkspacePageContext } from './WorkspacePage';
import { useResource } from './useResource';

export function RequestPage({context}:{context:WorkspacePageContext}) {
  const location=useLocation();const navigate=useNavigate();const params=new URLSearchParams(location.search);
  const draftId=params.get('draftId')??'';
  const draft=useResource(`${context.scope}:request-draft:${draftId}`,signal=>api.requestSnapshot(draftId,signal),0,!!draftId);
  const requestedType=params.get('type');const type:RequestType=requestedType==='RENEW'||requestedType==='REVOKE'?requestedType:'CREATE';
  const close=useCallback(()=>navigate(draftId?`/requests/${encodeURIComponent(draftId)}`:'/requests',{replace:!!draftId}),[draftId,navigate]);
  const complete=useCallback((id?:string)=>navigate(id?`/requests/${encodeURIComponent(id)}`:'/requests',{replace:true}),[navigate]);
  const editable=draft.data?.status==='DRAFT'&&draft.data.creatorId===context.user.id&&
    Number.isSafeInteger(draft.data.version)&&draft.data.version!>0;
  return <><PageHeader eyebrow="Không gian cá nhân" title={draftId?'Sửa bản nháp':'Tạo yêu cầu mới'}
    description="Bạn có thể lưu bản nháp hoặc gửi yêu cầu tới người phê duyệt."/>
    {draftId&&draft.loading?<p role="status">Đang tải bản nháp…</p>
      :draftId&&(draft.error||!editable)?<>
        <div className="data-banner data-banner-error" role="alert">{draft.error||'Yêu cầu này không còn chỉnh sửa được.'}</div>
        <div className="heading-actions">
          {draft.error&&<button className="secondary-button" onClick={draft.retry}>Thử lại</button>}
          <button className="quiet-button" onClick={close}>Về chi tiết yêu cầu</button>
        </div>
      </>:<RequestModal key={draftId||`${type}:${params.get('assetId')??''}`} userId={context.user.id} scope={context.scope}
        policyRevision={context.revisions.policies} initialType={type} initialAssetId={params.get('assetId')??undefined}
        initialDraft={draftId&&editable?draft.data!:undefined} onClose={close} onComplete={complete}/>}
  </>;
}
