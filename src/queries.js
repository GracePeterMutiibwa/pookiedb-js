'use strict';

const fs = require('fs');
const PookieDBError = require('./error');

const TYPE_MAP = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'INTEGER',
  json: 'TEXT',
  date: 'TEXT'
};

function createTable(db, tableName, tableSchema) {
  const columns = [
    'id TEXT PRIMARY KEY',
    'created_at TEXT NOT NULL'
  ];

  for (const [fieldName, def] of Object.entries(tableSchema)) {
    const sqlType = TYPE_MAP[def.type.toLowerCase()];
    let col = `${fieldName} ${sqlType}`;
    if (def.unique) col += ' UNIQUE';
    columns.push(col);
  }

  const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columns.join(', ')})`;
  try {
    db.prepare(sql).run();
  } catch (err) {
    throw new PookieDBError('QUERY_FAILED', `Failed to create table "${tableName}": ${err.message}`);
  }
}

function insertRecord(db, tableName, record) {
  const keys = Object.keys(record);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map(key => record[key]);
  const sql = `INSERT INTO "${tableName}" (${keys.join(', ')}) VALUES (${placeholders})`;

  try {
    db.prepare(sql).run(...values);
  } catch (err) {
    throw new PookieDBError('QUERY_FAILED', `Insert into "${tableName}" failed: ${err.message}`);
  }
}

function updateRecord(db, tableName, id, data) {
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const setClause = keys.map(key => `"${key}" = ?`).join(', ');
  const values = keys.map(key => data[key]);
  const sql = `UPDATE "${tableName}" SET ${setClause} WHERE id = ?`;

  try {
    db.prepare(sql).run(...values, id);
  } catch (err) {
    throw new PookieDBError('QUERY_FAILED', `Update on "${tableName}" failed: ${err.message}`);
  }
}

function upsertRecord(db, tableName, data, onField) {
  const existing = db.prepare(`SELECT id FROM "${tableName}" WHERE "${onField}" = ?`).get(data[onField]);
  return existing ? existing.id : null;
}

function deleteRecords(db, tableName, where) {
  const { sql: whereSql, params } = buildWhere(where);
  const sql = `DELETE FROM "${tableName}"${whereSql ? ' WHERE ' + whereSql : ''}`;

  try {
    const result = db.prepare(sql).run(...params);
    return result.changes;
  } catch (err) {
    throw new PookieDBError('QUERY_FAILED', `Delete from "${tableName}" failed: ${err.message}`);
  }
}

function selectRecords(db, tableName, queryState) {
  const { filters, excludes, order, limitVal, offsetVal, fieldsMask } = queryState;

  const selectedCols = fieldsMask.length > 0
    ? fieldsMask.map(f => `"${f}"`).join(', ')
    : '*';

  let sql = `SELECT ${selectedCols} FROM "${tableName}"`;
  const params = [];

  const whereParts = [];

  for (const conditions of filters) {
    const { sql: condSql, params: condParams } = buildWhere(conditions);
    if (condSql) {
      whereParts.push(`(${condSql})`);
      params.push(...condParams);
    }
  }

  for (const conditions of excludes) {
    const { sql: condSql, params: condParams } = buildWhere(conditions);
    if (condSql) {
      whereParts.push(`NOT (${condSql})`);
      params.push(...condParams);
    }
  }

  if (whereParts.length > 0) {
    sql += ' WHERE ' + whereParts.join(' AND ');
  }

  if (order.length > 0) {
    const orderClauses = order.map(field => {
      if (field.startsWith('-')) return `"${field.slice(1)}" DESC`;
      return `"${field}" ASC`;
    });
    sql += ' ORDER BY ' + orderClauses.join(', ');
  }

  if (limitVal !== null) {
    sql += ` LIMIT ${limitVal}`;
  }

  if (offsetVal !== null) {
    sql += ` OFFSET ${offsetVal}`;
  }

  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    throw new PookieDBError('QUERY_FAILED', `Select from "${tableName}" failed: ${err.message}`);
  }
}

function countRecords(db, tableName, queryState) {
  const { filters, excludes } = queryState;
  let sql = `SELECT COUNT(*) as count FROM "${tableName}"`;
  const params = [];
  const whereParts = [];

  for (const conditions of filters) {
    const { sql: condSql, params: condParams } = buildWhere(conditions);
    if (condSql) {
      whereParts.push(`(${condSql})`);
      params.push(...condParams);
    }
  }

  for (const conditions of excludes) {
    const { sql: condSql, params: condParams } = buildWhere(conditions);
    if (condSql) {
      whereParts.push(`NOT (${condSql})`);
      params.push(...condParams);
    }
  }

  if (whereParts.length > 0) {
    sql += ' WHERE ' + whereParts.join(' AND ');
  }

  try {
    const row = db.prepare(sql).get(...params);
    return row.count;
  } catch (err) {
    throw new PookieDBError('QUERY_FAILED', `Count on "${tableName}" failed: ${err.message}`);
  }
}

function tableExists(db, tableName) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
  return !!row;
}

function getFileSize(dbPath) {
  try {
    return fs.statSync(dbPath).size;
  } catch {
    return 0;
  }
}

function sqlSafe(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function buildWhere(conditions) {
  if (!conditions || Object.keys(conditions).length === 0) {
    return { sql: '', params: [] };
  }

  const parts = [];
  const params = [];

  for (const [key, value] of Object.entries(conditions)) {
    if (key === '__all') continue;

    const underscoreIndex = key.indexOf('__');
    let fieldName, lookup;

    if (underscoreIndex === -1) {
      fieldName = key;
      lookup = null;
    } else {
      fieldName = key.slice(0, underscoreIndex);
      lookup = key.slice(underscoreIndex + 2);
    }

    const col = `"${fieldName}"`;

    if (!lookup || lookup === 'eq') {
      parts.push(`${col} = ?`);
      params.push(sqlSafe(value));
    } else if (lookup === 'ne') {
      parts.push(`${col} != ?`);
      params.push(sqlSafe(value));
    } else if (lookup === 'gt') {
      parts.push(`${col} > ?`);
      params.push(sqlSafe(value));
    } else if (lookup === 'gte') {
      parts.push(`${col} >= ?`);
      params.push(sqlSafe(value));
    } else if (lookup === 'lt') {
      parts.push(`${col} < ?`);
      params.push(sqlSafe(value));
    } else if (lookup === 'lte') {
      parts.push(`${col} <= ?`);
      params.push(sqlSafe(value));
    } else if (lookup === 'contains') {
      parts.push(`${col} LIKE ?`);
      params.push(`%${value}%`);
    } else if (lookup === 'icontains') {
      parts.push(`${col} LIKE ? COLLATE NOCASE`);
      params.push(`%${value}%`);
    } else if (lookup === 'startswith') {
      parts.push(`${col} LIKE ?`);
      params.push(`${value}%`);
    } else if (lookup === 'endswith') {
      parts.push(`${col} LIKE ?`);
      params.push(`%${value}`);
    } else if (lookup === 'in') {
      const placeholders = value.map(() => '?').join(', ');
      parts.push(`${col} IN (${placeholders})`);
      params.push(...value.map(sqlSafe));
    } else if (lookup === 'notin') {
      const placeholders = value.map(() => '?').join(', ');
      parts.push(`${col} NOT IN (${placeholders})`);
      params.push(...value.map(sqlSafe));
    } else if (lookup === 'isnull') {
      parts.push(value ? `${col} IS NULL` : `${col} IS NOT NULL`);
    } else if (lookup === 'range') {
      parts.push(`${col} BETWEEN ? AND ?`);
      params.push(sqlSafe(value[0]), sqlSafe(value[1]));
    }
  }

  return { sql: parts.join(' AND '), params };
}

module.exports = {
  createTable,
  insertRecord,
  updateRecord,
  upsertRecord,
  deleteRecords,
  selectRecords,
  countRecords,
  tableExists,
  getFileSize,
  buildWhere
};
