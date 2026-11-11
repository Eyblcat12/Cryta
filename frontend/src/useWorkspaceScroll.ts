import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

// One owner for window scroll. POP restoration waits for asynchronously loaded rows.
export function useWorkspaceScroll(scope: string) {
  const location=useLocation();
  const navigationType=useNavigationType();
  const history=useRef(new Map<string,number>());
  const position=useRef<number|null>(null);
  const previous=useRef<{scope:string;path:string}|null>(null);
  useLayoutEffect(()=>{
    if(previous.current?.scope!==scope)history.current.clear();
    const samePage=previous.current?.scope===scope&&previous.current.path===location.pathname;
    previous.current={scope,path:location.pathname};
    const saved=navigationType==='POP'?history.current.get(location.key):undefined;
    let restoring=saved!==undefined&&saved>0;
    let observer:MutationObserver|null=null;
    let timer:number|undefined;
    let frame=0;
    const stop=()=>{restoring=false;observer?.disconnect();if(timer)window.clearTimeout(timer);window.cancelAnimationFrame(frame)};
    const remember=()=>{position.current=window.scrollY;if(!restoring)history.current.set(location.key,position.current)};
    const restore=()=>{
      if(saved===undefined)return;
      const maximum=document.documentElement.scrollHeight-window.innerHeight;
      if(maximum>=saved){window.scrollTo({top:saved,behavior:'instant'});position.current=saved;history.current.set(location.key,saved);stop()}
    };
    const watch=(align:()=>void)=>{
      observer=new MutationObserver(()=>{window.cancelAnimationFrame(frame);frame=window.requestAnimationFrame(align)});
      observer.observe(document.getElementById('main-content')??document.body,{childList:true,subtree:true,attributes:true});
      timer=window.setTimeout(stop,10000);
    };
    if(restoring){
      watch(restore);frame=window.requestAnimationFrame(restore);
    }else{
      const table=samePage&&navigationType!=='POP'?document.querySelector<HTMLElement>('main .content-section'):null;
      if(table){
        restoring=true;
        const align=()=>{
          const headerBottom=document.querySelector('.topbar')?.getBoundingClientRect().bottom??0;
          const target=Math.max(0,table.getBoundingClientRect().top+window.scrollY-headerBottom-16);
          window.scrollTo({top:target,behavior:'instant'});
          const busy=table.getAttribute('aria-busy')==='true'||!!table.querySelector('[aria-busy="true"]');
          if(document.documentElement.scrollHeight-window.innerHeight>=target||!busy){position.current=target;history.current.set(location.key,target);stop()}
        };
        watch(align);frame=window.requestAnimationFrame(align);
      }else{
        history.current.set(location.key,0);
        // Reading scrollY or calling scrollTo during React's commit forces the
        // newly mounted table to lay out synchronously, even at the same offset.
        // Scroll events own the cached offset; only reset when it can differ.
        if(position.current!==0)frame=window.requestAnimationFrame(()=>{window.scrollTo({top:0,behavior:'instant'});position.current=0});
      }
    }
    const cancel=()=>{stop();remember()};
    window.addEventListener('scroll',remember,{passive:true});
    window.addEventListener('wheel',cancel,{passive:true});
    window.addEventListener('touchstart',cancel,{passive:true});
    const keydown=(event:KeyboardEvent)=>{if(['PageDown','PageUp','Home','End','ArrowDown','ArrowUp'].includes(event.key))cancel()};
    window.addEventListener('keydown',keydown);
    if(history.current.size>100)history.current.delete(history.current.keys().next().value!);
    return()=>{stop();window.removeEventListener('scroll',remember);window.removeEventListener('wheel',cancel);window.removeEventListener('touchstart',cancel);window.removeEventListener('keydown',keydown)};
  },[scope,location.key]);
}
