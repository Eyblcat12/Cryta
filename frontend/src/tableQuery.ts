export function positivePage(value: string | null) {
  return boundedInteger(value,1,1_000_000);
}

export function boundedInteger(value:string|null,fallback:number,maximum:number) {
  if(value===null||!/^\d+$/.test(value)||value.startsWith('0'))return fallback;
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&parsed>0&&parsed<=maximum?parsed:fallback;
}

export interface TableQueryOptions {
  defaultPageSize?:number;
  search?:boolean;
  enabled?:boolean;
  filters?:Readonly<Record<string,readonly string[] | ((value: string) => boolean)>>;
}
export interface TableQueryChanges { page?:number; pageSize?:number; status?:string; q?:string; filters?:Record<string,string> }

function singleValue(params:URLSearchParams,key:string) {
  const values=params.getAll(key);
  return values.length&&values.every(value=>value===values[0])?values[0]:null;
}
function write(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

export function parseTableQuery(params:URLSearchParams,statuses:readonly string[],options:TableQueryOptions={}) {
  const defaultPageSize=options.defaultPageSize??25;
  const page=positivePage(singleValue(params,'page'));
  const pageSize=boundedInteger(singleValue(params,'pageSize'),defaultPageSize,100);
  const status=allowedValue(singleValue(params,'status'),statuses);
  const search=options.search===false?'':cleanQuery(singleValue(params,'q'));
  const filters:Record<string,string>={};
  const normalized=new URLSearchParams(params);
  const supported=new Set(['page','pageSize',...(statuses.length?['status']:[]),...(options.search===false?[]:['q']),...Object.keys(options.filters??{})]);
  for(const key of new Set(params.keys()))if(!supported.has(key))normalized.delete(key);
  write(normalized,'page',page>1?String(page):'');
  write(normalized,'pageSize',pageSize!==defaultPageSize?String(pageSize):'');
  write(normalized,'status',status);write(normalized,'q',search);
  for(const [key,rule] of Object.entries(options.filters??{})) {
    const value = singleValue(params,key);
    filters[key] = typeof rule === 'function' ? (value && rule(value) ? value : '') : allowedValue(value,rule);
    write(normalized,key,filters[key]);
  }
  return {page,pageSize,status,search,filters,params:normalized};
}

export function changeTableQuery(params:URLSearchParams,statuses:readonly string[],options:TableQueryOptions,changes:TableQueryChanges) {
  const current=parseTableQuery(params,statuses,options);
  const next=new URLSearchParams(current.params);
  if(changes.pageSize!==undefined)next.set('pageSize',String(changes.pageSize));
  if(changes.status!==undefined)write(next,'status',changes.status);
  if(changes.q!==undefined)write(next,'q',changes.q);
  for(const [key,value] of Object.entries(changes.filters??{}))write(next,key,value);
  const applied=parseTableQuery(next,statuses,options);
  const filtering=current.pageSize!==applied.pageSize||current.status!==applied.status||current.search!==applied.search||JSON.stringify(current.filters)!==JSON.stringify(applied.filters);
  write(next,'page',String(changes.page??(filtering?1:current.page)));
  return parseTableQuery(next,statuses,options).params;
}

export function cleanQuery(value: string | null, maxLength = 100) {
  return (value ?? '').trim().slice(0, maxLength);
}

export function allowedValue<T extends string>(value: string | null, allowed: readonly T[]): T | '' {
  return value && allowed.includes(value as T) ? value as T : '';
}
