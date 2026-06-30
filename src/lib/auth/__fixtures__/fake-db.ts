/**
 * یک «DB جعلیِ» سبکِ درون‌حافظه‌ای برای تستِ واحدِ لایه‌ی auth — بدون DB/شبکه‌ی زنده.
 *
 * فقط همان زیرمجموعه‌ی APIِ Drizzle که core.ts/pairing.ts استفاده می‌کنند پیاده شده:
 *   • db.insert(table).values(obj).returning()
 *   • db.select().from(table).where(cond).limit(n)
 *   • db.update(table).set(obj).where(cond).returning?()
 *
 * شرط‌ها (`eq`, `and`, `isNull`) با پیمایشِ ساختارِ داخلیِ SQLِ Drizzle (queryChunks)
 * تفسیر می‌شوند: هر شرط یک predicate روی ردیف می‌سازد. این عمداً مینیمال است و فقط
 * عملگرهای موردِاستفاده‌ی این لایه را می‌فهمد.
 */
import { getTableName, type SQL, type Table } from "drizzle-orm";

type Row = Record<string, unknown>;

/** نگاشتِ نامِ ستونِ DB (snake_case) → کلیدِ شیِ ردیف (camelCase) برای هر جدول. */
type ColumnMap = Record<string, string>;

/** یک predicate روی ردیف. */
type Predicate = (row: Row) => boolean;

/** یک توکنِ تخت‌شده از queryChunks. */
type Token =
  | { kind: "col"; name: string }
  | { kind: "op"; text: string }
  | { kind: "param"; value: unknown };

/** نشانهٔ یک SQLِ تو‌در‌توی Drizzle (دارای queryChunks). */
function isNestedSql(ch: unknown): ch is { queryChunks: unknown[] } {
  return !!ch && typeof ch === "object" && "queryChunks" in ch;
}

/** queryChunks را (با بازگشت در SQLهای تو‌در‌تو، مثلِ `and(...)`) به توکن‌های تخت تبدیل می‌کند. */
function flatten(cond: { queryChunks?: unknown[] }, out: Token[]): void {
  for (const ch of cond.queryChunks ?? []) {
    if (typeof ch === "string") continue;
    if (!ch || typeof ch !== "object") continue;
    // ستون (Column): فیلدِ name رشته‌ای دارد و queryChunks ندارد.
    if ("name" in ch && typeof (ch as { name: unknown }).name === "string" && !isNestedSql(ch)) {
      out.push({ kind: "col", name: (ch as { name: string }).name });
      continue;
    }
    // SQLِ تو‌در‌تو (مثلِ زیرشرط‌های and) → بازگشت.
    if (isNestedSql(ch)) {
      flatten(ch as { queryChunks: unknown[] }, out);
      continue;
    }
    // StringChunk عملگر: { value: string[] }.
    if ("value" in ch && Array.isArray((ch as { value: unknown }).value)) {
      out.push({ kind: "op", text: (ch as { value: string[] }).value.join("").trim().toLowerCase() });
      continue;
    }
    // Param: مقدارِ سمتِ راست.
    if ("value" in ch) {
      out.push({ kind: "param", value: (ch as { value: unknown }).value });
      continue;
    }
  }
}

/**
 * یک SQLِ Drizzle (محصولِ eq/and/isNull) را به predicate تبدیل می‌کند. همه‌ی شرط‌ها
 * با AND ترکیب می‌شوند (تنها ترکیبی که این لایه استفاده می‌کند). الگوها:
 *   • برابری:  COL، OP `=`، PARAM
 *   • is null: COL، OP `is null`
 */
function toPredicate(cond: SQL | undefined, colMap: ColumnMap): Predicate {
  if (!cond) return () => true;
  const tokens: Token[] = [];
  flatten(cond as unknown as { queryChunks: unknown[] }, tokens);

  const preds: Predicate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.kind !== "col") continue;
    const key = colMap[tok.name] ?? tok.name;
    const op = tokens[i + 1];
    if (op?.kind === "op" && op.text === "is null") {
      preds.push((r) => r[key] === null || r[key] === undefined);
    } else if (op?.kind === "op" && op.text === "=") {
      const param = tokens[i + 2];
      const value = param?.kind === "param" ? param.value : undefined;
      preds.push((r) => r[key] === value);
    }
  }

  return (row) => preds.every((p) => p(row));
}

/** نسخه‌ی deep-clone ساده برای جداسازیِ ردیف‌های ذخیره‌شده از مرجع‌های بیرونی. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (_k, val) => val) as T;
}

/**
 * DBِ جعلی. هر جدول یک آرایه‌ی ردیف دارد. تاریخ‌ها به‌صورت Date نگه‌داری می‌شوند
 * (نه stringِ JSON) تا کدِ تولید که `.getTime()` صدا می‌زند کار کند.
 */
export class FakeAuthDb {
  /** نام‌جدول → ردیف‌ها. */
  private tables = new Map<string, Row[]>();
  /** نام‌جدول → نگاشتِ ستون. */
  private colMaps = new Map<string, ColumnMap>();
  private idSeq = 0;

  /** یک جدول را با نگاشتِ ستونِ snake→camel ثبت می‌کند. */
  register(table: Table, colMap: ColumnMap): this {
    const name = getTableName(table);
    if (!this.tables.has(name)) this.tables.set(name, []);
    this.colMaps.set(name, colMap);
    return this;
  }

  /** همه‌ی ردیف‌های یک جدول (برای assertion در تست). */
  rows(table: Table): Row[] {
    return this.tables.get(getTableName(table)) ?? [];
  }

  private nextId(): string {
    this.idSeq += 1;
    return `00000000-0000-4000-8000-${String(this.idSeq).padStart(12, "0")}`;
  }

  insert(table: Table) {
    const name = getTableName(table);
    const rows = this.tables.get(name)!;
    return {
      values: (vals: Row) => {
        const row: Row = {
          id: this.nextId(),
          createdAt: new Date(),
          ...clone(vals),
        };
        // Date در values را حفظ کن (clone روی Date به string تبدیل می‌کند).
        for (const [k, v] of Object.entries(vals)) {
          if (v instanceof Date) row[k] = v;
        }
        return {
          returning: async () => {
            rows.push(row);
            return [clonePreservingDates(row)];
          },
          then: (resolve: (v: unknown) => unknown) => {
            rows.push(row);
            return Promise.resolve(resolve(undefined));
          },
        };
      },
    };
  }

  select() {
    return {
      from: (table: Table) => {
        const name = getTableName(table);
        const colMap = this.colMaps.get(name) ?? {};
        const all = this.tables.get(name)!;
        const builder = {
          _pred: (() => true) as Predicate,
          _limit: Infinity,
          where(cond: SQL) {
            this._pred = toPredicate(cond, colMap);
            return this;
          },
          limit(n: number) {
            this._limit = n;
            return this;
          },
          then(resolve: (rows: Row[]) => unknown) {
            const out = all
              .filter((r) => this._pred(r))
              .slice(0, this._limit)
              .map(clonePreservingDates);
            return Promise.resolve(resolve(out));
          },
        };
        return builder;
      },
    };
  }

  update(table: Table) {
    const name = getTableName(table);
    const colMap = this.colMaps.get(name) ?? {};
    const all = this.tables.get(name)!;
    return {
      set: (patch: Row) => {
        const apply = (pred: Predicate) => {
          const changed: Row[] = [];
          for (const r of all) {
            if (pred(r)) {
              Object.assign(r, patch);
              changed.push(clonePreservingDates(r));
            }
          }
          return changed;
        };
        return {
          where(cond: SQL) {
            const pred = toPredicate(cond, colMap);
            return {
              returning: async () => apply(pred),
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(resolve(apply(pred))),
            };
          },
        };
      },
    };
  }
}

/** clone که Dateها را حفظ می‌کند (JSON.parse/stringify آن‌ها را خراب می‌کند). */
function clonePreservingDates(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? new Date(v.getTime()) : v;
  }
  return out;
}
