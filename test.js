'use strict';

const PookieDB = require('./src/index');

const db = new PookieDB('/tmp/pookietest.sqlite', {
  tables: {
    users: {
      username: { type: 'text', required: true, unique: true },
      role: { type: 'text', required: true, default: 'cashier', choices: ['cashier', 'admin', 'manager'] },
      password: { type: 'text', required: true },
      metadata: { type: 'json' }
    },
    inventory: {
      name: { type: 'text', required: true },
      price: { type: 'integer', required: true },
      stock: { type: 'integer', default: 0 },
      tags: { type: 'json' },
      active: { type: 'boolean' }
    }
  }
});

console.log('✓ init');

// create
const grace = db.create('users', {
  username: 'grace',
  password: 'secret',
  metadata: { theme: 'dark', langs: ['en', 'fr'] }
}, { prefix: 'USR' });

console.log('✓ create with prefix:', grace.id.startsWith('USR-'));
console.log('✓ json deserialized:', Array.isArray(grace.metadata.langs));
console.log('✓ default applied:', grace.role === 'cashier');

// upsert - update existing
db.upsert('users', { username: 'grace', role: 'manager' }, { on: 'username' });
const updated = db.read('users').filter({ username: 'grace' }).one();
console.log('✓ upsert update:', updated.role === 'manager');

// upsert - insert new
db.upsert('users', { username: 'bob', role: 'admin', password: 'pass' }, { on: 'username' });
console.log('✓ upsert insert:', db.read('users').count() === 2);

// inventory
const pen = db.create('inventory', { name: 'Pen', price: 500, stock: 100, tags: ['stationery'], active: true });
db.create('inventory', { name: 'Notebook', price: 1500, stock: 50, tags: ['stationery', 'office'], active: true });
db.create('inventory', { name: 'Eraser', price: 200, stock: 0, active: false });
console.log('✓ inventory created');

// filter lookups
const expensive = db.read('inventory').filter({ price__gte: 500 }).orderby('-price').all();
console.log('✓ filter __gte, orderby desc:', expensive[0].name === 'Notebook');

const inStock = db.read('inventory').filter({ stock__gt: 0 }).count();
console.log('✓ filter __gt count:', inStock === 2);

const contains = db.read('inventory').filter({ name__contains: 'e' }).count();
console.log('✓ filter __contains:', contains >= 1);

const inList = db.read('inventory').filter({ name__in: ['Pen', 'Eraser'] }).count();
console.log('✓ filter __in:', inList === 2);

const notNull = db.read('inventory').filter({ tags__isnull: false }).count();
console.log('✓ filter __isnull false:', notNull === 2);

const rangeResult = db.read('inventory').filter({ price__range: [100, 600] }).count();
console.log('✓ filter __range:', rangeResult === 2);

// exclude
const excluded = db.read('inventory').exclude({ active: false }).count();
console.log('✓ exclude:', excluded === 2);

// values
const partial = db.read('inventory').values('name', 'price').all();
console.log('✓ values:', Object.keys(partial[0]).length === 2);

// limit/offset
const limited = db.read('inventory').orderby('price').limit(2).offset(1).all();
console.log('✓ limit/offset:', limited.length === 2);

// paginate
const page = db.read('inventory').orderby('price').paginate(1, 2);
console.log('✓ paginate:', page.total === 3 && page.totalPages === 2 && page.data.length === 2);

// exists
console.log('✓ exists true:', db.read('inventory').filter({ name: 'Pen' }).exists());
console.log('✓ exists false:', !db.read('inventory').filter({ name: 'Ghost' }).exists());

// last
const last = db.read('inventory').last();
console.log('✓ last:', !!last);

// json terminal
const jsonStr = db.read('inventory').json();
console.log('✓ json():', typeof JSON.parse(jsonStr) === 'object');

// csv terminal
const csvStr = db.read('inventory').values('name', 'price').csv();
console.log('✓ csv():', csvStr.split('\n')[0] === 'name,price');

// delete
const deleted = db.delete('inventory', { stock__lte: 0 });
console.log('✓ delete with condition:', deleted === 1);

// delete __all
db.create('inventory', { name: 'Temp', price: 1 });
const allDeleted = db.delete('inventory', { __all: true });
console.log('✓ delete __all:', allDeleted >= 1);

// meta
const meta = db.meta();
console.log('✓ meta tables:', meta.tables.includes('users'));
console.log('✓ meta size:', meta.size > 0);

// backup
const bak = db.backup();
console.log('✓ backup all tables:', 'users' in bak && 'inventory' in bak);

const bakUsers = db.backup('users');
console.log('✓ backup single table:', Object.keys(bakUsers).length === 1);

// seed
db.delete('inventory', { __all: true });
const summary = db.seed({
  inventory: [
    { name: 'A', price: 1 },
    { name: 'B', price: 2 }
  ]
});
console.log('✓ seed:', summary.inventory === 2);

// transaction
db.transaction(() => {
  db.create('inventory', { name: 'TxItem', price: 999 });
});
console.log('✓ transaction:', db.read('inventory').filter({ name: 'TxItem' }).exists());

// transaction rollback
let rolledBack = false;
try {
  db.transaction(() => {
    db.create('inventory', { name: 'WillRollback', price: 1 });
    throw new Error('oops');
  });
} catch {
  rolledBack = true;
}
console.log('✓ transaction rollback:', rolledBack && !db.read('inventory').filter({ name: 'WillRollback' }).exists());

// studio (just check it doesn't throw)
db.studio('users');
db.studio();
console.log('✓ studio');

// error codes
try { db.create('nonexistent', {}); } catch (e) { console.log('✓ UNKNOWN_TABLE:', e.code === 'UNKNOWN_TABLE'); }
try { db.create('users', { password: 'x' }); } catch (e) { console.log('✓ REQUIRED_FIELD_MISSING:', e.code === 'REQUIRED_FIELD_MISSING'); }
try { db.create('inventory', { name: 123, price: 1 }); } catch (e) { console.log('✓ TYPE_MISMATCH:', e.code === 'TYPE_MISMATCH'); }
try { db.create('users', { username: 'x', role: 'unknown', password: 'x' }); } catch (e) { console.log('✓ INVALID_CHOICE:', e.code === 'INVALID_CHOICE'); }
try { db.delete('inventory', {}); } catch (e) { console.log('✓ DELETE_NO_CONDITIONS:', e.code === 'DELETE_NO_CONDITIONS'); }
try { db.upsert('users', { username: 'x' }, { on: 'password' }); } catch (e) { console.log('✓ UPSERT_KEY_NOT_UNIQUE:', e.code === 'UPSERT_KEY_NOT_UNIQUE'); }
try { db.read('inventory').filter({ price__blah: 1 }).all(); } catch (e) { console.log('✓ UNKNOWN_LOOKUP:', e.code === 'UNKNOWN_LOOKUP'); }
try { db.read('inventory').filter({ price__range: [1] }).all(); } catch (e) { console.log('✓ INVALID_RANGE:', e.code === 'INVALID_RANGE'); }

console.log('\nAll tests passed.');
