import { useEffect,useSyncExternalStore } from 'react';
import { mutationSnapshot,subscribeMutations } from './workspaceMutations';
export function useWorkspaceMutations(){return useSyncExternalStore(subscribeMutations,mutationSnapshot,mutationSnapshot)}
export function useMutationGuard(key:string){return useWorkspaceMutations().find(item=>item.key===key&&item.phase!=='confirmed')}

// Mounted forms own their notices; closed forms fall back to the workspace notice.
const owners=new Map<string,number>();
let inlineKeys:readonly string[]=[];
const ownerListeners=new Set<()=>void>();
function updateOwners(){inlineKeys=[...owners.keys()];for(const listener of ownerListeners)listener()}
export function useInlineMutationNotice(key:string){
  useEffect(()=>{owners.set(key,(owners.get(key)??0)+1);updateOwners();return()=>{const count=(owners.get(key)??1)-1;if(count)owners.set(key,count);else owners.delete(key);updateOwners()}},[key]);
}
export function useInlineMutationKeys(){return useSyncExternalStore(listener=>{ownerListeners.add(listener);return()=>{ownerListeners.delete(listener)}},()=>inlineKeys,()=>inlineKeys)}
