import { Link } from 'react-router';
import { useState } from 'react';
import { canOpenView,workspaceView } from './routes';
import type { AuthUser,UserRole } from './types';
import { dismissMutation,inspectMutation,mutationLabels } from './workspaceMutations';
import type { WorkspaceMutation } from './workspaceMutations';
import { readMutationState } from './mutationReview';
import { useInlineMutationKeys,useInlineMutationNotice,useMutationGuard,useWorkspaceMutations } from './useWorkspaceMutations';

function MutationNotice({item,user,role}:{item:WorkspaceMutation;user?:AuthUser;role?:UserRole}){
  const [compared,setCompared]=useState(false);
  if(item.phase==='confirmed')return null;
  if(item.phase==='pending')return <div className="data-banner mutation-notice" role="status"><strong>{mutationLabels[item.kind]}: đang chờ máy chủ xác nhận.</strong><span>Rời trang không hủy thao tác tại máy chủ.</span></div>;
  const allowed=!!user&&!!role&&canOpenView(role,workspaceView(item.reviewPath),user.roles);
  return <section className="data-banner data-banner-error mutation-notice" aria-label="Kết quả thao tác chưa rõ">
    <div role="alert"><strong>Chưa xác nhận kết quả: {mutationLabels[item.kind]}.</strong><p>Thao tác có thể đã được thực hiện. Kiểm tra dữ liệu trước khi gửi lại.{item.requestId&&` Mã phản hồi: ${item.requestId}.`}</p><p>Hãy đối chiếu trước khi tải lại hoặc đóng tab; thông tin theo dõi này không được khôi phục sau đó.</p></div>
    <div className="mutation-review" aria-live="polite">
      {item.reviewing&&<p role="status">Đang kiểm tra dữ liệu…</p>}
      {item.reviewError&&<p role="alert">{item.reviewError}</p>}
      {item.review&&<><p>{item.review}</p><p>Kết quả lần gửi trước vẫn chưa được xác nhận.</p></>}
    </div>
    <div className="heading-actions"><button type="button" className="secondary-button" disabled={item.reviewing} onClick={()=>{setCompared(false);void inspectMutation(item.id,readMutationState)}}>{item.reviewing?'Đang kiểm tra…':'Kiểm tra dữ liệu'}</button>{allowed&&<Link className="text-button" to={item.reviewPath}>Mở dữ liệu liên quan</Link>}</div>
    {item.reviewedAt&&<div className="mutation-acknowledgment"><label><input type="checkbox" checked={compared} onChange={event=>setCompared(event.target.checked)}/> Tôi đã đối chiếu dữ liệu và hiểu lần gửi trước có thể đã được thực hiện.</label><button type="button" className="quiet-button" disabled={!compared||item.reviewing} onClick={()=>dismissMutation(item.id)}>Kết thúc đối chiếu</button></div>}
  </section>;
}
export function MutationGuardNotice({operationKey}:{operationKey:string}){useInlineMutationNotice(operationKey);const item=useMutationGuard(operationKey);return item?<MutationNotice key={item.id} item={item}/>:null}
export function WorkspaceMutationNotices({user,role}:{user:AuthUser;role:UserRole}){
  const operations=useWorkspaceMutations();
  const inlineKeys=useInlineMutationKeys();
  return <>{operations.filter(item=>item.owner===user.id&&item.phase!=='confirmed'&&!inlineKeys.includes(item.key)).map(item=><MutationNotice key={item.id} item={item} user={user} role={role}/>)}</>;
}
