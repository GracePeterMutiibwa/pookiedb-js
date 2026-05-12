'use strict';

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const PookieDBError = require('./error');
const {
  validateSchema,
  validateRecord,
  validateConditions,
  coerce,
  deserialize
} = require('./validators');
const {
  createTable,
  insertRecord,
  updateRecord,
  upsertRecord,
  deleteRecords,
  selectRecords,
  countRecords,
  getFileSize,
  buildWhere
} = require('./queries');

class QueryBuilder {
  constructor(db, tableName, schema) {
    this._db = db;
    this._tableName = tableName;
    this._schema = schema;
    this._tableSchema = schema[tableName];
    this._filters = [];
    this._excludes = [];
    this._order = [];
    this._limitVal = null;
    this._offsetVal = null;
    this._fieldsMask = [];
  }

  filter(conditions) {
    validateConditions(conditions, this._tableName, this._schema);
    this._filters.push(conditions);
    return this;
  }

  exclude(conditions) {
    validateConditions(conditions, this._tableName, this._schema);
    this._excludes.push(conditions);
    return this;
  }

  orderby(...fields) {
    this._order.push(...fields);
    return this;
  }

  limit(n) {
    this._limitVal = n;
    return this;
  }

  offset(n) {
    this._offsetVal = n;
    return this;
  }

  values(...fields) {
    this._fieldsMask = fields;
    return this;
  }

  _queryState() {
    return {
      filters: this._filters,
      excludes: this._excludes,
      order: this._order,
      limitVal: this._limitVal,
      offsetVal: this._offsetVal,
      fieldsMask: this._fieldsMask
    };
  }

  _deserializeRows(rows) {
    if (this._fieldsMask.length > 0) return rows;
    return rows.map(row => deserialize(row, this._tableSchema));
  }

  all() {
    const rows = selectRecords(this._db, this._tableName, this._queryState());
    return this._deserializeRows(rows);
  }

  one() {
    const state = { ...this._queryState(), limitVal: 1 };
    const rows = selectRecords(this._db, this._tableName, state);
    if (rows.length === 0) return null;
    return this._fieldsMask.length > 0 ? rows[0] : deserialize(rows[0], this._tableSchema);
  }

  first() {
    return this.one();
  }

  last() {
    const state = {
      ...this._queryState(),
      order: ['-created_at'],
      limitVal: 1
    };
    const rows = selectRecords(this._db, this._tableName, state);
    if (rows.length === 0) return null;
    return this._fieldsMask.length > 0 ? rows[0] : deserialize(rows[0], this._tableSchema);
  }

  count() {
    return countRecords(this._db, this._tableName, this._queryState());
  }

  exists() {
    return this.count() > 0;
  }

  json() {
    return JSON.stringify(this.all());
  }

  csv() {
    const rows = this.all();
    if (rows.length === 0) return '';

    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];

    for (const row of rows) {
      const values = headers.map(header => {
        const val = row[header];
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      });
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  paginate(page, perPage) {
    const total = this.count();
    const totalPages = Math.ceil(total / perPage);
    const state = {
      ...this._queryState(),
      limitVal: perPage,
      offsetVal: (page - 1) * perPage
    };
    const rows = selectRecords(this._db, this._tableName, state);
    return {
      data: this._deserializeRows(rows),
      total,
      page,
      perPage,
      totalPages
    };
  }
}

class PookieDB {
  constructor(dbPath, { tables } = {}) {
    if (!tables || typeof tables !== 'object') {
      throw new PookieDBError('INVALID_SCHEMA', 'Constructor requires a "tables" option with schema definitions');
    }

    validateSchema(tables);

    try {
      this.db = new Database(dbPath);
    } catch (err) {
      throw new PookieDBError('INIT_FAILED', `Cannot open database at "${dbPath}": ${err.message}`);
    }

    this.schema = {};
    for (const [tableName, fields] of Object.entries(tables)) {
      this.schema[tableName] = {};
      for (const [fieldName, def] of Object.entries(fields)) {
        this.schema[tableName][fieldName] = { ...def, type: def.type.toLowerCase() };
      }
    }

    this.path = dbPath;

    for (const [tableName, tableSchema] of Object.entries(this.schema)) {
      createTable(this.db, tableName, tableSchema);
    }
  }

  _resolveTable(tableName) {
    if (!this.schema[tableName]) {
      throw new PookieDBError('UNKNOWN_TABLE', `Unknown table "${tableName}". Known tables: ${Object.keys(this.schema).join(', ')}`);
    }
  }

  _buildRecord(tableName, data, options = {}) {
    const tableSchema = this.schema[tableName];
    const record = {};

    const prefix = options.prefix ? options.prefix.toUpperCase() : null;
    const rawId = uuidv4();
    record.id = prefix ? `${prefix}-${rawId}` : rawId;
    record.created_at = new Date().toISOString();

    for (const [fieldName, def] of Object.entries(tableSchema)) {
      let value = data[fieldName];

      if (value === undefined || value === null) {
        if (def.default !== undefined) {
          value = def.default;
        } else {
          value = null;
        }
      }

      record[fieldName] = coerce(value, def.type.toLowerCase());
    }

    return record;
  }

  create(tableName, data, options = {}) {
    this._resolveTable(tableName);

    const cleanData = { ...data };
    delete cleanData.id;
    delete cleanData.created_at;

    validateRecord(tableName, this.schema, cleanData);

    const tableSchema = this.schema[tableName];
    for (const [fieldName, def] of Object.entries(tableSchema)) {
      if (def.unique && cleanData[fieldName] !== undefined && cleanData[fieldName] !== null) {
        const existing = this.db
          .prepare(`SELECT id FROM "${tableName}" WHERE "${fieldName}" = ?`)
          .get(cleanData[fieldName]);
        if (existing) {
          throw new PookieDBError('QUERY_FAILED', `Table "${tableName}", field "${fieldName}": unique constraint violated for value "${cleanData[fieldName]}"`);
        }
      }
    }

    const record = this._buildRecord(tableName, cleanData, options);
    insertRecord(this.db, tableName, record);

    return deserialize(
      this.db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).get(record.id),
      tableSchema
    );
  }

  upsert(tableName, data, options = {}) {
    this._resolveTable(tableName);

    const { on } = options;
    if (!on) {
      throw new PookieDBError('UPSERT_KEY_NOT_UNIQUE', `upsert() on table "${tableName}" requires an "on" option`);
    }

    const tableSchema = this.schema[tableName];
    const isValidKey = on === 'id' || (tableSchema[on] && tableSchema[on].unique === true);
    if (!isValidKey) {
      throw new PookieDBError('UPSERT_KEY_NOT_UNIQUE', `Table "${tableName}", field "${on}": upsert "on" field must be "id" or declared unique: true`);
    }

    if (data[on] === undefined || data[on] === null) {
      throw new PookieDBError('REQUIRED_FIELD_MISSING', `Table "${tableName}": upsert "on" field "${on}" must be present in data`);
    }

    const existingId = upsertRecord(this.db, tableName, data, on);

    if (existingId) {
      const cleanData = { ...data };
      delete cleanData.id;
      delete cleanData.created_at;

      validateRecord(tableName, this.schema, cleanData, { partial: true });

      const coerced = {};
      for (const [fieldName, value] of Object.entries(cleanData)) {
        if (fieldName === on && on !== 'id') continue;
        const def = tableSchema[fieldName];
        if (def) {
          coerced[fieldName] = coerce(value, def.type.toLowerCase());
        }
      }

      updateRecord(this.db, tableName, existingId, coerced);
      return deserialize(
        this.db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).get(existingId),
        tableSchema
      );
    }

    return this.create(tableName, data, options);
  }

  read(tableName) {
    this._resolveTable(tableName);
    return new QueryBuilder(this.db, tableName, this.schema);
  }

  delete(tableName, conditions) {
    this._resolveTable(tableName);

    if (!conditions || Object.keys(conditions).length === 0) {
      throw new PookieDBError('DELETE_NO_CONDITIONS', `Table "${tableName}": delete() requires conditions. Pass { __all: true } to delete all records.`);
    }

    if (conditions.__all !== true) {
      validateConditions(conditions, tableName, this.schema);
    }

    const where = conditions.__all === true ? {} : conditions;
    return deleteRecords(this.db, tableName, where);
  }

  meta() {
    const tables = Object.keys(this.schema);
    const counts = {};
    for (const tableName of tables) {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get();
      counts[tableName] = row.count;
    }

    return {
      path: this.path,
      tables,
      counts,
      schema: this.schema,
      size: getFileSize(this.path)
    };
  }

  backup(tableName) {
    const result = {};

    if (tableName) {
      this._resolveTable(tableName);
      const rows = this.db.prepare(`SELECT * FROM "${tableName}"`).all();
      result[tableName] = rows.map(row => deserialize(row, this.schema[tableName]));
    } else {
      for (const name of Object.keys(this.schema)) {
        const rows = this.db.prepare(`SELECT * FROM "${name}"`).all();
        result[name] = rows.map(row => deserialize(row, this.schema[name]));
      }
    }

    return result;
  }

  seed(data) {
    const summary = {};

    const runSeeds = this.db.transaction(() => {
      for (const [tableName, records] of Object.entries(data)) {
        this._resolveTable(tableName);
        let count = 0;
        for (const record of records) {
          this.create(tableName, record);
          count++;
        }
        summary[tableName] = count;
      }
    });

    runSeeds();
    return summary;
  }

  transaction(fn) {
    const wrapped = this.db.transaction(fn);
    return wrapped();
  }

  studio(tableName) {
    if (tableName) {
      this._resolveTable(tableName);
      const rows = this.db.prepare(`SELECT * FROM "${tableName}"`).all();
      const deserialized = rows.map(row => deserialize(row, this.schema[tableName]));
      printTable(tableName, deserialized);
    } else {
      for (const name of Object.keys(this.schema)) {
        const rows = this.db.prepare(`SELECT * FROM "${name}"`).all();
        const deserialized = rows.map(row => deserialize(row, this.schema[name]));
        printTable(name, deserialized);
      }
    }
  }
}

function printTable(tableName, rows) {
  if (rows.length === 0) {
    console.log(`\n┌─ ${tableName} (0 records) ┐`);
    return;
  }

  const headers = Object.keys(rows[0]);
  const colWidths = headers.map(h => h.length);

  for (const row of rows) {
    headers.forEach((h, i) => {
      const val = row[h];
      const str = val === null || val === undefined ? 'NULL' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      colWidths[i] = Math.max(colWidths[i], str.length);
    });
  }

  const totalWidth = colWidths.reduce((sum, w) => sum + w + 3, 1);
  const title = ` ${tableName} (${rows.length} record${rows.length !== 1 ? 's' : ''}) `;

  console.log('\n┌' + title.padEnd(totalWidth - 1, '─') + '┐');

  const headerRow = '│ ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ ') + ' │';
  console.log(headerRow);
  console.log('├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤');

  for (const row of rows) {
    const cells = headers.map((h, i) => {
      const val = row[h];
      const str = val === null || val === undefined ? 'NULL' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      return str.padEnd(colWidths[i]);
    });
    console.log('│ ' + cells.join(' │ ') + ' │');
  }

  console.log('└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');
}

module.exports = PookieDB;
module.exports.PookieDB = PookieDB;
module.exports.PookieDBError = PookieDBError;
