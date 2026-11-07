import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string;
  errorStatus: number | null;
  retry: () => void;
}

// The mounting feature owns this read. A new key can never expose the old snapshot.
export function useResource<T>(key:string,load:(signal:AbortSignal)=>Promise<T>,revision=0,enabled=true):Resource<T> {
  const loader=useRef(load);loader.current=load;
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;revision:number;attempt:number;data:T|null;loading:boolean;error:string;errorStatus:number|null}>({key,revision,attempt,data:null,loading:enabled,error:'',errorStatus:null});
  useEffect(()=>{
    if(!enabled){setState({key,revision,attempt,data:null,loading:false,error:'',errorStatus:null});return}
    let current=true;const controller=new AbortController();
    setState(previous=>({key,revision,attempt,data:previous.key===key?previous.data:null,loading:true,error:'',errorStatus:null}));
    void Promise.resolve().then(()=>{
      if(controller.signal.aborted)throw new DOMException('Resource abandoned','AbortError');
      return loader.current(controller.signal);
    }).then(data=>{if(current)setState({key,revision,attempt,data,loading:false,error:'',errorStatus:null})}).catch(error=>{
      if(!current||controller.signal.aborted)return;
      const inaccessible=error instanceof ApiError&&[401,403,404].includes(error.status);
      setState(previous=>({key,revision,attempt,data:previous.key===key&&!inaccessible?previous.data:null,loading:false,error:error instanceof ApiError?error.message:'Không thể tải dữ liệu. Hãy thử lại.',errorStatus:error instanceof ApiError?error.status:null}));
    });
    return()=>{current=false;controller.abort()};
  },[key,revision,attempt,enabled]);
  const snapshot=state.key===key&&enabled?{...state,loading:state.loading||state.revision!==revision||state.attempt!==attempt}:{data:null,loading:enabled,error:'',errorStatus:null};
  return {...snapshot,retry:()=>setAttempt(value=>value+1)};
}
