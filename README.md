# pookiedb

Synchronous, file-based SQLite ORM for Node.js with a chainable API, Django-inspired query syntax, built-in validation, UUID primary keys, and first-class JSON support.

## Installation

```bash
npm install pookiedb
```

## Quick Start

```js
const PookieDB = require('pookiedb');

const db = new PookieDB('shop.sqlite', {
  tables: {
    users: {
      username: { type: 'text', required: true, unique: true },
      role:     { type: 'text', required: true, default: 'cashier' },
      password: { type: 'text', required: true },
      metadata: { type: 'json' }
    },
    inventory: {
      name:  { type: 'text', required: true },
      price: { type: 'integer', required: true },
      stock: { type: 'integer', default: 0 },
      tags:  { type: 'json' }
    }
  }
});

// Create a record
const item = db.create('inventory', {
  name: 'Stapler',
  price: 3500,
  stock: 20,
  tags: ['stationery', 'office']
}, { prefix: 'INV' });
// item.id → "INV-a1b2c3d4-..."

// Read with filters
const results = db.read('inventory')
  .filter({ price__gte: 1000 })
  .filter({ stock__gt: 0 })
  .orderby('-price')
  .limit(10)
  .all();

// Backup the whole database
const snapshot = db.backup();
// → { users: [...], inventory: [...] }
```

---

## API Reference

### `new PookieDB(path, { tables })`

Opens or creates a SQLite database at `path`. Creates tables that do not exist. Never drops or alters existing tables.

Every table automatically gets `id` (TEXT PRIMARY KEY) and `created_at` (TEXT, ISO timestamp) columns. Do not declare these in the schema.

Returns a `PookieDB` instance synchronously.

---

### `db.create(table, data, options?)`

Inserts a new record. Returns the full inserted record as a plain JS object.

```js
db.create('users', { username: 'grace', role: 'admin', password: 'x' })
db.create('users', { username: 'grace', role: 'admin', password: 'x' }, { prefix: 'ADM' })
```

- `options.prefix` - optional string prepended to the UUID (uppercased, hyphen-separated)
- Runs all validations before writing
- `id` in `data` is silently ignored; a UUID is always generated

---

### `db.upsert(table, data, options)`

Updates an existing record if a match is found, inserts a new one if not.

```js
db.upsert('users', { username: 'grace', role: 'manager' }, { on: 'username' })
db.upsert('inventory', { id: 'INV-xxx', stock: 50 }, { on: 'id' })
```

- `options.on` (required) - the field to match on. Must be `id` or a field declared `unique: true`
- Returns the final state of the record

---

### `db.read(table)` → QueryBuilder

Returns a chainable query builder. No database call happens until a terminal method is called.

#### Chaining methods

| Method | Description |
|--------|-------------|
| `.filter(conditions)` | Add WHERE conditions. Multiple calls are ANDed. |
| `.exclude(conditions)` | Negate conditions (NOT WHERE). |
| `.orderby(...fields)` | Sort by fields. Prefix `-` for descending. |
| `.limit(n)` | Return at most `n` records. |
| `.offset(n)` | Skip the first `n` records. |
| `.values(...fields)` | Return only the specified fields. |

#### Terminal methods

| Method | Returns |
|--------|---------|
| `.all()` | Array of all matching records |
| `.one()` / `.first()` | First matching record or `null` |
| `.last()` | Last record by `created_at` desc, or `null` |
| `.count()` | Integer count |
| `.exists()` | Boolean |
| `.json()` | JSON string of matching records |
| `.csv()` | CSV string (first row is headers) |
| `.paginate(page, perPage)` | `{ data, total, page, perPage, totalPages }` |

---

### `db.delete(table, conditions)`

Deletes records matching conditions. Returns the number of deleted records.

```js
db.delete('inventory', { stock__lte: 0 })
db.delete('inventory', { __all: true })  // delete everything
```

Throws `DELETE_NO_CONDITIONS` if conditions object is empty or omitted. Pass `{ __all: true }` to intentionally delete all records.

---

### `db.meta()`

Returns a description of the current database state.

```js
{
  path: 'shop.sqlite',
  tables: ['users', 'inventory'],
  counts: { users: 3, inventory: 120 },
  schema: { ... },
  size: 45056   // bytes
}
```

---

### `db.backup(table?)`

Exports all records as a plain JS object. If a table name is given, exports only that table.

```js
db.backup()           // → { users: [...], inventory: [...] }
db.backup('users')    // → { users: [...] }
```

JSON fields are deserialized in the export.

---

### `db.seed(data)`

Inserts multiple records across one or more tables inside a single transaction.

```js
db.seed({
  inventory: [
    { name: 'Pen', price: 500 },
    { name: 'Notebook', price: 1500 }
  ]
})
// → { inventory: 2 }
```

Returns a count summary per table. Applies the same validations as `create()`.

---

### `db.transaction(fn)`

Wraps a function in a SQLite transaction. Rolls back automatically if the function throws.

```js
db.transaction(() => {
  db.create('sales', { item_id: 'INV-xxx', quantity: 2, total: 1000 })
  db.upsert('inventory', { id: 'INV-xxx', stock: 98 }, { on: 'id' })
})
```

Returns whatever the callback returns.

---

### `db.studio(table?)`

Prints a formatted table to stdout using Unicode box-drawing characters. For development use only.

```js
db.studio()            // print all tables
db.studio('inventory') // print one table
```

Returns `undefined`.

---

## Filter Lookups

All filter and exclude conditions use Django-style `field__lookup` syntax.

```js
db.read('inventory')
  .filter({ price__gte: 500, stock__gt: 0 })
  .filter({ name__contains: 'pen' })
  .all()
```

| Suffix | SQL |
|--------|-----|
| _(none)_ or `__eq` | `= value` |
| `__ne` | `!= value` |
| `__gt` | `> value` |
| `__gte` | `>= value` |
| `__lt` | `< value` |
| `__lte` | `<= value` |
| `__contains` | `LIKE '%value%'` |
| `__icontains` | `LIKE '%value%'` (case-insensitive) |
| `__startswith` | `LIKE 'value%'` |
| `__endswith` | `LIKE '%value'` |
| `__in` | `IN (v1, v2, ...)` |
| `__notin` | `NOT IN (v1, v2, ...)` |
| `__isnull` | `IS NULL` / `IS NOT NULL` depending on boolean |
| `__range` | `BETWEEN low AND high` (pass `[low, high]`) |

---

## Schema Field Types

Every field definition requires a `type`. All other options are optional.

| Type | JS validation | SQLite type |
|------|---------------|-------------|
| `text` | `typeof value === 'string'` | TEXT |
| `integer` | `Number.isInteger(value)` | INTEGER |
| `real` | finite number | REAL |
| `boolean` | `true` or `false` | INTEGER (0/1) |
| `json` | any serializable value | TEXT |
| `date` | `Date` instance or ISO 8601 string | TEXT |

### Field Options

| Option | Type | Description |
|--------|------|-------------|
| `type` | string | Required. One of the types above. |
| `required` | boolean | Throw if field is absent or null on `create()`. |
| `unique` | boolean | Add a UNIQUE constraint. |
| `default` | any | Used when field is absent on `create()`. Must match the field type. |
| `choices` | array | Value must be one of the listed options. |

---

## ID Prefix System

Every record gets a UUID v4 as its `id`. You can pass a `prefix` option to `create()` to make IDs human-readable:

```js
db.create('users', { ... }, { prefix: 'ADM' })
// id → "ADM-a1b2c3d4-e5f6-..."

db.create('inventory', { ... }, { prefix: 'INV' })
// id → "INV-b2c3d4e5-f6a7-..."
```

Prefixes are uppercased and separated from the UUID by a hyphen. The full prefixed string is stored as the primary key and used with `upsert({ on: 'id' })`.

---

## JSON Fields

Declare any field as `type: 'json'` to store arbitrary serializable JS values - arrays, nested objects, anything.

```js
const db = new PookieDB('app.sqlite', {
  tables: {
    products: {
      name: { type: 'text', required: true },
      tags: { type: 'json' },
      attributes: { type: 'json' }
    }
  }
})

db.create('products', {
  name: 'Widget',
  tags: ['sale', 'new'],
  attributes: { color: 'blue', weight: 1.2 }
})

const product = db.read('products').one()
product.tags        // → ['sale', 'new']        (Array, not string)
product.attributes  // → { color: 'blue', ... } (Object, not string)
```

`JSON.stringify` runs on write and `JSON.parse` runs on read, invisibly. No manual handling required.

---

## Transactions

Use `db.transaction(fn)` to wrap multiple operations into a single atomic SQLite transaction. If anything inside the function throws, the entire transaction is rolled back.

```js
db.transaction(() => {
  const sale = db.create('sales', {
    item_id: itemId,
    quantity: 2,
    total: 7000
  })
  db.upsert('inventory', {
    id: itemId,
    stock: currentStock - 2
  }, { on: 'id' })
})
```

`db.seed()` always runs inside a transaction automatically.

---

## Error Codes

All errors are instances of `PookieDBError` with a `code` property.

```js
const { PookieDBError } = require('pookiedb')

try {
  db.create('users', { password: 'x' })
} catch (err) {
  if (err instanceof PookieDBError) {
    console.log(err.code)    // 'REQUIRED_FIELD_MISSING'
    console.log(err.message) // 'Table "users": required field "username" is missing or null'
  }
}
```

| Code | When thrown |
|------|-------------|
| `INIT_FAILED` | Database file cannot be opened or created |
| `INVALID_SCHEMA` | Schema contains unknown types or malformed options |
| `UNKNOWN_TABLE` | A table name does not exist in the schema |
| `REQUIRED_FIELD_MISSING` | A `required: true` field is absent or null |
| `TYPE_MISMATCH` | A field value does not match its declared type |
| `INVALID_CHOICE` | A field value is not in its `choices` list |
| `UPSERT_KEY_NOT_UNIQUE` | The `on` field in `upsert()` is not `id` or `unique: true` |
| `DELETE_NO_CONDITIONS` | `delete()` called with empty conditions without `__all: true` |
| `UNKNOWN_LOOKUP` | A filter uses an unrecognized suffix |
| `INVALID_RANGE` | A `__range` value is not a two-element array |
| `SERIALIZATION_FAILED` | A `json` field value cannot be serialized |
| `QUERY_FAILED` | A SQLite error occurred during query execution |

---

## Note on Synchronous Design

PookieDB is synchronous by design. There are no promises, no async/await, and no callbacks anywhere in the public API. This makes it suitable for Electron apps, CLI tools, Express middleware, and any context where synchronous SQLite access is appropriate.
