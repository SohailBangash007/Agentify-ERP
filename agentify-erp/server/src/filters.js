import { today, addDays, bad } from './util.js';

/**
 * Build a WHERE fragment from {logic:'AND'|'OR', rules:[{field,op,value}]}.
 * `fieldMap` is a whitelist of field -> SQL expression, so user input never reaches SQL text.
 */
export function buildWhere(fieldMap, logic = 'AND', rules = []) {
  const parts = [];
  const params = [];
  for (const r of rules || []) {
    const col = fieldMap[r.field];
    if (!col) throw bad(`Unknown filter field: ${r.field}`);
    let v = r.value;
    if (v === 'today') v = today();
    if (v === 'tomorrow') v = addDays(today(), 1);
    const op = r.op || 'eq';
    switch (op) {
      case 'eq': parts.push(`${col} = ?`); params.push(v); break;
      case 'neq': parts.push(`(${col} IS NULL OR ${col} <> ?)`); params.push(v); break;
      case 'gt': parts.push(`${col} > ?`); params.push(v); break;
      case 'gte': parts.push(`${col} >= ?`); params.push(v); break;
      case 'lt': parts.push(`${col} < ?`); params.push(v); break;
      case 'lte': parts.push(`${col} <= ?`); params.push(v); break;
      case 'contains': parts.push(`${col} LIKE ?`); params.push(`%${v}%`); break;
      case 'in': {
        const list = Array.isArray(v) ? v : String(v).split(',');
        if (!list.length) break;
        parts.push(`${col} IN (${list.map(() => '?').join(',')})`); params.push(...list); break;
      }
      case 'between': {
        const [a, b] = Array.isArray(v) ? v : String(v).split(',');
        parts.push(`${col} BETWEEN ? AND ?`); params.push(a, b); break;
      }
      case 'empty': parts.push(`(${col} IS NULL OR ${col} = '' OR ${col} = '[]')`); break;
      case 'not_empty': parts.push(`(${col} IS NOT NULL AND ${col} <> '' AND ${col} <> '[]')`); break;
      case 'last_days': parts.push(`${col} >= ?`); params.push(addDays(today(), -Number(v) || 0)); break;
      default: throw bad(`Unknown filter operator: ${op}`);
    }
  }
  if (!parts.length) return { sql: '1=1', params: [] };
  return { sql: `(${parts.join(logic === 'OR' ? ' OR ' : ' AND ')})`, params };
}
