export type FieldType = 'text' | 'integer' | 'real' | 'boolean' | 'json' | 'date';

export interface FieldDefinition {
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  choices?: unknown[];
}

export type TableSchema = Record<string, FieldDefinition>;
export type Schema = Record<string, TableSchema>;

export interface PookieDBOptions {
  tables: Schema;
}

export interface CreateOptions {
  prefix?: string;
}

export interface UpsertOptions {
  on: string;
}

export interface PaginateResult<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface MetaResult {
  path: string;
  tables: string[];
  counts: Record<string, number>;
  schema: Schema;
  size: number;
}

export interface SeedSummary {
  [table: string]: number;
}

export declare class QueryBuilder {
  filter(conditions: Record<string, unknown>): this;
  exclude(conditions: Record<string, unknown>): this;
  orderby(...fields: string[]): this;
  limit(n: number): this;
  offset(n: number): this;
  values(...fields: string[]): this;
  all(): Record<string, unknown>[];
  one(): Record<string, unknown> | null;
  first(): Record<string, unknown> | null;
  last(): Record<string, unknown> | null;
  count(): number;
  exists(): boolean;
  json(): string;
  csv(): string;
  paginate(page: number, perPage: number): PaginateResult;
}

export declare class PookieDBError extends Error {
  name: 'PookieDBError';
  code: string;
  constructor(code: string, message: string);
}

export declare class PookieDB {
  constructor(path: string, options: PookieDBOptions);
  create(table: string, data: Record<string, unknown>, options?: CreateOptions): Record<string, unknown>;
  upsert(table: string, data: Record<string, unknown>, options: UpsertOptions): Record<string, unknown>;
  read(table: string): QueryBuilder;
  delete(table: string, conditions: Record<string, unknown>): number;
  meta(): MetaResult;
  backup(table?: string): Record<string, Record<string, unknown>[]>;
  seed(data: Record<string, Record<string, unknown>[]>): SeedSummary;
  transaction<T>(fn: () => T): T;
  studio(table?: string): void;
}

export { PookieDB as default };
