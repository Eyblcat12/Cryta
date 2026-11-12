import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { RotateCw,X } from 'lucide-react';
import { api } from './api';
import { DetailLoadingOutline } from './LoadingOutline';
import { AssetDetailPage,RequestDetailPage } from './WorkspaceDetailPages';
import { PageHeader } from './WorkspaceUi';
import { useResource } from './useResource';
import { useDelayedPending } from './useDelayedPending';
import type { WorkspacePageContext } from './WorkspacePage';
import type { Asset,RequestItem } from './types';
import { canChangeAsset,canDecideRequest } from './workspacePermissions';
import { canCreateRequests } from './workspacePermissions';
import { CancelRequestDialog } from './WorkspaceDialogs';
import { useMutationGuard } from './useWorkspaceMutations';
import { canOpenView } from './routes';
type Detail={kind:'asset';asset:Asset}|{kind:'request';request:RequestItem};

export function WorkspaceDetailRoute({context}:{context:WorkspacePageContext}) {
  const location=useLocation();const kind=context.view==='assets'?'assets':'requests';
  const navigate=useNavigate();
  const [cancel,setCancel]=useState<{id:string;version:number}|null>(null);
  const operation=useMutationGuard(`request:${dataId(location.pathname)}`);
  const resource=useResource<Detail>(`${context.scope}:${location.pathname}`,signal=>{
    const id=decodeURIComponent(location.pathname.split('/')[2]);
    return kind==='assets'?api.assetDetail(id,signal).then(asset=>({kind:'asset' as const,asset})):api.requestDetail(id,signal).then(request=>({kind:'request' as const,request}));
  },context.revisions[kind]);
  const pending=useDelayedPending(resource.loading,`${context.scope}:${location.pathname}`);
  const title=kind==='assets'?'Chi tiết tài sản':'Chi tiết yêu cầu';
  const data=resource.data;
  const actionable=data?.kind==='request'&&!resource.loading&&!resource.error&&!operation&&
    data.request.creatorId===context.user.id&&Number.isSafeInteger(data.request.version)&&Number(data.request.version)>0;
  const editable=actionable&&context.role==='USER'&&canCreateRequests(context.user)&&data.request.status==='DRAFT';
  const cancellable=actionable&&['DRAFT','PENDING'].includes(data.request.status);
  return <>
    <div className="table-heading-actions detail-route-actions"><button className="icon-button" aria-label="Làm mới chi tiết" disabled={resource.loading} onClick={resource.retry}><RotateCw size={17}/></button></div>
    <section aria-label="Chi tiết" aria-busy={resource.loading} className="resource-region detail-resource">
      <div className="resource-pending" role="status" aria-live="polite">{pending&&(resource.data?'Đang cập nhật…':'Đang tải chi tiết…')}</div>
      {resource.error&&<div className="data-banner data-banner-error" role="alert"><span>Chi tiết: {resource.error}{resource.data&&' Đang hiển thị dữ liệu lần tải trước.'}</span><button onClick={resource.retry}>Thử lại</button></div>}
      <div className="resource-body">{data?(data.kind==='asset'
      ?<AssetDetailPage asset={data.asset} historyRevision={context.revisions.assets} canOpenRequests={canOpenView(context.role,'requests',context.user.roles)} canRequest={context.role==='USER'&&canChangeAsset(context.user,data.asset)&&!resource.loading&&!resource.error} onClose={context.onCloseDetail} onRenew={()=>context.openRequest('RENEW',data.asset.id)} onRevoke={()=>context.openRequest('REVOKE',data.asset.id)}/>
      :<RequestDetailPage request={data.request} currentUserId={context.user.id} onClose={context.onCloseDetail}
        onEdit={editable?()=>navigate(`/requests/new?draftId=${encodeURIComponent(data.request.id)}`):undefined}
        onCancel={cancellable?()=>setCancel({id:data.request.id,version:Number(data.request.version)}):undefined}
        onDecision={context.role==='APPROVER'&&canDecideRequest(context.user,data.request)&&!resource.loading&&!resource.error&&!operation
          ?action=>context.onDecision(action,data.request.id,Number(data.request.version),data.request.approval ? data.request.approval.approved===0?1:2 : undefined)
          :undefined}/>)
      :resource.loading?<section className="asset-detail-page" aria-labelledby="page-title">
        <div className="drawer-header"><div className="drawer-title"><span className="asset-type-icon" aria-hidden="true"/><div><p aria-hidden="true"> </p><h1 id="page-title" tabIndex={-1}>{title}</h1></div></div><button className="icon-button" onClick={context.onCloseDetail} aria-label="Về danh sách"><X size={20}/></button></div>
        <DetailLoadingOutline kind={kind==='assets'?'asset':'request'} visible={pending}/>
        <div className="drawer-footer"><button className="quiet-button" onClick={context.onCloseDetail}>Về danh sách</button></div>
      </section>:<><PageHeader eyebrow="Chi tiết" title={title} description="Dữ liệu được kiểm tra theo quyền của phiên hiện tại."/><button className="secondary-button" onClick={context.onCloseDetail}>Về danh sách</button></>}</div>
    </section>
    {cancel&&cancel.id===dataId(location.pathname)&&<CancelRequestDialog requestId={cancel.id} version={cancel.version}
      onClose={()=>setCancel(null)} onSuccess={()=>{setCancel(null);resource.retry()}}/>}
  </>;
}

function dataId(pathname:string) { return pathname.split('/')[2]??''; }
