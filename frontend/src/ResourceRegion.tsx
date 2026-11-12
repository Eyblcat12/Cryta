import type { ReactNode } from 'react';
import type { Resource } from './useResource';
import { useDelayedPending } from './useDelayedPending';
import { LoadingOutline } from './LoadingOutline';

export function ResourceRegion<T>({resource,label,placeholder,children}:{resource:Resource<T>;label:string;placeholder?:ReactNode;children:(data:T)=>ReactNode}) {
  const pending=useDelayedPending(resource.loading,label);
  return <section aria-label={label} aria-busy={resource.loading} className="resource-region">
    <div className="resource-pending" role="status" aria-live="polite">{pending&&(resource.data?'Đang cập nhật…':`Đang tải ${label.toLocaleLowerCase('vi')}…`)}</div>
    {resource.error&&<div className="data-banner data-banner-error" role="alert"><span>{label}: {resource.error}{resource.data&&' Đang hiển thị dữ liệu lần tải trước.'}</span><button onClick={resource.retry}>Thử lại</button></div>}
    <div className="resource-body">{resource.data!==null?children(resource.data):resource.loading&&placeholder
      ?<LoadingOutline visible={pending}>{placeholder}</LoadingOutline>
      :<div className="resource-placeholder" aria-hidden="true"/>}</div>
  </section>;
}
