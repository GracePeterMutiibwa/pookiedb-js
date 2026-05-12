'use strict';

const VALID_TYPES = new Set(['text', 'integer', 'real', 'boolean', 'json', 'date']);

const VALID_LOOKUPS = new Set([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
  'contains', 'icontains', 'startswith', 'endswith',
  'in', 'notin', 'isnull', 'range'
]);

const VALID_FIELD_OPTIONS = new Set(['type', 'required', 'unique', 'default', 'choices']);

function validateSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new (require('./error'))('INVALID_SCHEMA', 'Schema must be a plain object');
  }

  for (const [tableName, fields] of Object.entries(schema)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new (require('./error'))('INVALID_SCHEMA', `Table "${tableName}": fields must be a plain object`);
    }

    for (const [fieldName, def] of Object.entries(fields)) {
      if (!def || typeof def !== 'object') {
        throw new (require('./error'))('INVALID_SCHEMA', `Table "${tableName}", field "${fieldName}": definition must be an object`);
      }

      if (!def.type) {
        throw new (require('./error'))('INVALID_SCHEMA', `Table "${tableName}", field "${fieldName}": "type" is required`);
      }

      const normalizedType = def.type.toLowerCase();
      if (!VALID_TYPES.has(normalizedType)) {
        throw new (require('./error'))('INVALID_SCHEMA', `Table "${tableName}", field "${fieldName}": unknown type "${def.type}". Must be one of: ${[...VALID_TYPES].join(', ')}`);
      }

      for (const key of Object.keys(def)) {
        if (!VALID_FIELD_OPTIONS.has(key)) {
          throw new (require('./error'))('INVALID_SCHEMA', `Table "${tableName}", field "${fieldName}": unknown option "${key}"`);
        }
      }

      if (def.choices !== undefined && !Array.isArray(def.choices)) {
        throw new (require('./error'))('INVALID_SCHEMA', `Table "${tableName}", field "${fieldName}": "choices" must be an array`);
      }

      if (def.default !== undefined) {
        validateType(tableName, fieldName, def.default, normalizedType);
      }
    }
  }
}

function validateRecord(tableName, schema, data, { partial = false } = {}) {
  const PookieDBError = require('./error');
  const tableSchema = schema[tableName];

  for (const key of Object.keys(data)) {
    if (key === 'id' || key === 'created_at') continue;
    if (!tableSchema[key]) {
      throw new PookieDBError('UNKNOWN_FIELD', `Table "${tableName}": unknown field "${key}"`);
    }
  }

  for (const [fieldName, def] of Object.entries(tableSchema)) {
    const normalizedType = def.type.toLowerCase();
    const value = data[fieldName];
    const isAbsent = value === undefined || value === null;

    if (isAbsent) {
      if (!partial && def.required && def.default === undefined) {
        throw new PookieDBError('REQUIRED_FIELD_MISSING', `Table "${tableName}": required field "${fieldName}" is missing or null`);
      }
      continue;
    }

    validateType(tableName, fieldName, value, normalizedType);

    if (def.choices !== undefined && !def.choices.includes(value)) {
      throw new PookieDBError('INVALID_CHOICE', `Table "${tableName}", field "${fieldName}": value "${value}" is not in choices [${def.choices.join(', ')}]`);
    }
  }
}

function validateType(tableName, fieldName, value, type) {
  const PookieDBError = require('./error');

  switch (type) {
    case 'text':
      if (typeof value !== 'string') {
        throw new PookieDBError('TYPE_MISMATCH', `Table "${tableName}", field "${fieldName}": expected text (string), got ${typeof value}`);
      }
      break;
    case 'integer':
      if (!Number.isInteger(value)) {
        throw new PookieDBError('TYPE_MISMATCH', `Table "${tableName}", field "${fieldName}": expected integer, got ${value}`);
      }
      break;
    case 'real':
      if (typeof value !== 'number' || !isFinite(value)) {
        throw new PookieDBError('TYPE_MISMATCH', `Table "${tableName}", field "${fieldName}": expected real (finite number), got ${value}`);
      }
      break;
    case 'boolean':
      if (value !== true && value !== false) {
        throw new PookieDBError('TYPE_MISMATCH', `Table "${tableName}", field "${fieldName}": expected boolean, got ${typeof value}`);
      }
      break;
    case 'json': {
      try {
        JSON.stringify(value);
      } catch {
        throw new PookieDBError('SERIALIZATION_FAILED', `Table "${tableName}", field "${fieldName}": value cannot be JSON serialized`);
      }
      break;
    }
    case 'date':
      if (!(value instanceof Date) && !isValidISODate(value)) {
        throw new PookieDBError('TYPE_MISMATCH', `Table "${tableName}", field "${fieldName}": expected a Date instance or ISO 8601 string`);
      }
      break;
  }
}

function isValidISODate(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

function validateConditions(conditions, tableName, schema) {
  const PookieDBError = require('./error');
  const tableSchema = schema[tableName];

  if (conditions.__all === true) return;

  for (const key of Object.keys(conditions)) {
    if (key === '__all') continue;

    const parts = key.split('__');
    const fieldName = parts[0];
    const lookup = parts.slice(1).join('__') || null;

    const knownFields = new Set([...Object.keys(tableSchema), 'id', 'created_at']);
    if (!knownFields.has(fieldName)) {
      throw new PookieDBError('UNKNOWN_FIELD', `Table "${tableName}": unknown field "${fieldName}" in filter`);
    }

    if (lookup && !VALID_LOOKUPS.has(lookup)) {
      throw new PookieDBError('UNKNOWN_LOOKUP', `Table "${tableName}": unknown lookup suffix "__${lookup}" on field "${fieldName}"`);
    }

    if (lookup === 'range') {
      const val = conditions[key];
      if (!Array.isArray(val) || val.length !== 2) {
        throw new PookieDBError('INVALID_RANGE', `Table "${tableName}", field "${fieldName}": __range requires a two-element array`);
      }
    }
  }
}

function coerce(value, type) {
  if (value === undefined || value === null) return null;

  switch (type) {
    case 'boolean': return value ? 1 : 0;
    case 'json': {
      try {
        return JSON.stringify(value);
      } catch {
        throw new (require('./error'))('SERIALIZATION_FAILED', 'JSON field value cannot be serialized');
      }
    }
    case 'date':
      return value instanceof Date ? value.toISOString() : value;
    default:
      return value;
  }
}

function deserialize(row, tableSchema) {
  if (!row) return null;
  const result = { ...row };

  for (const [fieldName, def] of Object.entries(tableSchema)) {
    const type = def.type.toLowerCase();
    if (!(fieldName in result)) continue;

    if (type === 'json' && typeof result[fieldName] === 'string') {
      try {
        result[fieldName] = JSON.parse(result[fieldName]);
      } catch {
        // leave as string if unparseable
      }
    } else if (type === 'boolean') {
      result[fieldName] = result[fieldName] === 1 || result[fieldName] === true;
    }
  }

  return result;
}

module.exports = {
  validateSchema,
  validateRecord,
  validateConditions,
  coerce,
  deserialize,
  VALID_LOOKUPS
};
