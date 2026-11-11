import { describe, expect, it } from 'vitest';
import { allowedValue,changeTableQuery,cleanQuery,parseTableQuery,positivePage } from './tableQuery';

describe('table query parser', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['999', 999],
    [null, 1],
    ['0', 1],
    ['-3', 1],
    ['1.5', 1],
    ['abc', 1],
    ['02',1],['2e1',1],[' 2',1],['+2',1],['0x10',1],['1000001',1],['9007199254740993',1],['1000000',1000000],
  ])('normalizes page %s', (raw, expected) => {
    expect(positivePage(raw)).toBe(expected);
  });

  it('trims and limits free-text query values', () => {
    expect(cleanQuery('  Nguyễn  ')).toBe('Nguyễn');
    expect(cleanQuery('abcdefgh', 4)).toBe('abcd');
  });

  it('accepts only declared enum values', () => {
    const allowed = ['ACTIVE', 'LOCKED'] as const;
    expect(allowedValue('ACTIVE', allowed)).toBe('ACTIVE');
    expect(allowedValue('BAD', allowed)).toBe('');
    expect(allowedValue(null, allowed)).toBe('');
  });
  it('uses supported pageSize and removes unknown filters without preserving a misleading URL',()=>{
    const result=parseTableQuery(new URLSearchParams('page=2&pageSize=50&status=ACTIVE&q=%20TLS%20&sort=fake&role=ADMIN'),['ACTIVE']);
    expect(result).toMatchObject({page:2,pageSize:50,status:'ACTIVE',search:'TLS'});
    expect(result.params.has('sort')).toBe(false);expect(result.params.has('role')).toBe(false);
    expect(result.params.get('q')).toBe('TLS');
  });
  it('rejects ambiguous repeated query values and canonicalizes identical duplicates',()=>{
    const result=parseTableQuery(new URLSearchParams('page=2&page=3&pageSize=50&pageSize=50&q=a&q=b&status=BAD'),['ACTIVE']);
    expect(result).toMatchObject({page:1,pageSize:50,search:'',status:''});expect(result.params.toString()).toBe('pageSize=50');
  });
  it('uses defaults and backend bounds for invalid pagination',()=>{
    expect(parseTableQuery(new URLSearchParams('page=1&pageSize=101'),[],{defaultPageSize:10}).params.toString()).toBe('');
    expect(parseTableQuery(new URLSearchParams('pageSize=17'),[]).pageSize).toBe(17);
    expect(parseTableQuery(new URLSearchParams('pageSize=25'),[]).params.has('pageSize')).toBe(false);
  });
  it('resets page for a changed filter or pageSize, preserves valid filters and uses paging history for page-only changes',()=>{
    const params=new URLSearchParams('status=ACTIVE&q=TLS&pageSize=50&page=4');
    expect(changeTableQuery(params,['ACTIVE'],{}, {pageSize:100}).toString()).toBe('status=ACTIVE&q=TLS&pageSize=100');
    expect(changeTableQuery(params,['ACTIVE'],{}, {page:5}).get('page')).toBe('5');
    expect(changeTableQuery(params,['ACTIVE'],{}, {q:'PKI'}).has('page')).toBe(false);
  });
  it('preserves endpoint-specific filters and ignores unsupported search',()=>{
    const options={defaultPageSize:20,search:false,filters:{emergency:['1']}};
    const parsed=parseTableQuery(new URLSearchParams('q=ignored&emergency=1&page=2'),[],options);
    expect(parsed.search).toBe('');expect(parsed.filters.emergency).toBe('1');
    expect(changeTableQuery(parsed.params,[],options,{filters:{emergency:''}}).toString()).toBe('');
  });
});
