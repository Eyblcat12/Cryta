import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { changeTableQuery,parseTableQuery } from './tableQuery';
import type { TableQueryChanges,TableQueryOptions } from './tableQuery';

export function useUrlTableQuery<T extends string>(statuses: readonly T[],options:TableQueryOptions={}) {
  const [params, setParams] = useSearchParams();
  const parsed=parseTableQuery(params,statuses,options);
  const {page,pageSize,status,search,filters}=parsed;
  const [searchInput, setSearchInput] = useState(search);
  const canonical=parsed.params.toString();
  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    if(options.enabled!==false&&canonical!==params.toString())setParams(new URLSearchParams(canonical),{replace:true});
  }, [canonical,options.enabled,params,setParams]);
  const updateQuery = (changes:TableQueryChanges, replace = false) => {
    setParams(changeTableQuery(params,statuses,options,changes),{replace});
  };
  return { page,pageSize,status,search,filters,searchInput,setSearchInput,updateQuery };
}
