import { BadRequestException } from '@nestjs/common';

/** Columns and fallback expressions are supplied by the caller, never by the query string. */
export function listOrder(
  query: Record<string, string>,
  columns: Readonly<Record<string, string>>,
  idColumn: string,
  fallback: string,
) {
  if (query.sortBy === undefined && query.sortOrder === undefined) return fallback;
  if (typeof query.sortBy !== 'string' || !Object.hasOwn(columns, query.sortBy) ||
      (query.sortOrder !== undefined && query.sortOrder !== 'asc' && query.sortOrder !== 'desc')) {
    throw new BadRequestException({ code: 'INVALID_SORT', message: 'Cột hoặc chiều sắp xếp không hợp lệ.' });
  }
  const direction = query.sortOrder === 'desc' ? 'DESC' : 'ASC';
  return `${columns[query.sortBy]} ${direction} NULLS LAST, ${idColumn} ${direction}`;
}
