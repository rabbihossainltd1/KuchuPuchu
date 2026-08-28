export {};

/**
 * Minimal ambient types for the Workers runtime bindings this file uses.
 *
 * D1Database/D1PreparedStatement were declared before, but R2Bucket and
 * ExecutionContext were not, so `npm run typecheck` failed with TS2304 on
 * lines 9, 452 and 468 of index.ts. These declarations mirror the subset of
 * @cloudflare/workers-types that the worker actually touches, so the project
 * typechecks without pulling the full Workers type package.
 */
declare global {
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
  }

  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  }

  interface R2HTTPMetadata {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
  }

  interface R2Object {
    body: ReadableStream<Uint8Array>;
    httpMetadata?: R2HTTPMetadata;
    writeHttpMetadata(headers: Headers): void;
  }

  interface R2Bucket {
    get(key: string): Promise<R2Object | null>;
    put(
      key: string,
      value: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | string,
      options?: { httpMetadata?: R2HTTPMetadata },
    ): Promise<R2Object>;
    delete(keys: string | string[]): Promise<void>;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }
}
