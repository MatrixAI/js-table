import resourceCounter from 'resource-counter';
import * as utils from './utils.js';

const { default: Counter } = resourceCounter;

class Table<R extends Record<string, any>> {
  public readonly keys: Set<keyof R>;

  /**
   * Indexes will store the values as keys to allow looksups.
   */
  protected indexes: Record<
    string,
    {
      index: Map<any, Set<number>>;
      f?: (v: any) => any;
    }
  >;

  /**
   * Derived indexes have to be in a separate namespace to avoid collisions.
   */
  protected indexesDerived: Record<
    string,
    {
      index: Map<any, Set<number>>;
      deps: Array<string>;
      f?: (...vs: Array<any>) => any;
    }
  >;

  /**
   * This keeps track of the dependencies of derived indexes.
   */
  protected indexesDerivedDeps: Record<string, Set<string>>;
  protected rowCounter = new Counter(0);
  protected rows: Map<number, R> = new Map();

  /**
   * Try to ensure that your keys indexed have low cardinality.
   * If they don't have low cardinality. The index will use up alot of memory.
   */
  public constructor(
    keys: Array<keyof R>,
    indexes: Array<
      | keyof R
      | [keyof R, (v: any) => any]
      | Array<keyof R>
      | [Array<keyof R>, (...vs: Array<any>) => any]
    > = [],
  ) {
    if (keys.length < 1) {
      throw new RangeError('Table needs at least 1 key');
    }
    this.keys = new Set(keys);
    this.indexes = {};
    this.indexesDerived = {};
    this.indexesDerivedDeps = {};
    for (const i of indexes) {
      if (typeof i === 'string') {
        this.indexes[i] = {
          index: new Map(),
        };
      } else if (
        Array.isArray(i) &&
        typeof i[0] === 'string' &&
        typeof i[1] === 'function'
      ) {
        const [k, f] = i;
        this.indexes[k as string] = {
          index: new Map(),
          f,
        };
      } else if (Array.isArray(i) && typeof i[0] === 'string') {
        const kDerived = i.join('');
        this.indexesDerived[kDerived] = {
          index: new Map(),
          deps: i as Array<string>,
        };
        for (const k of i) {
          const kDerivedSet = (this.indexesDerivedDeps[k as string] ??=
            new Set());
          kDerivedSet.add(kDerived);
        }
      } else if (
        Array.isArray(i) &&
        Array.isArray(i[0]) &&
        typeof i[1] === 'function'
      ) {
        const [ks, f] = i;
        const kDerived = ks.join('');
        this.indexesDerived[kDerived] = {
          index: new Map(),
          deps: ks as Array<string>,
          f,
        };
        for (const k of ks) {
          const kDerivedSet = (this.indexesDerivedDeps[k as string] ??=
            new Set());
          kDerivedSet.add(kDerived);
        }
      }
    }
  }

  public get count(): number {
    return this.rows.size;
  }

  public [Symbol.iterator](): IterableIterator<[number, Readonly<R>]> {
    return this.rows.entries();
  }

  /**
   * Gets a shallow copy of the table.
   */
  public getTable(): Map<number, Readonly<R>> {
    return new Map([...this.rows]);
  }

  /**
   * Clears the table of all rows, resets the counter, and clears all indexes.
   */
  public clearTable(): void {
    this.rows.clear();
    for (const k in this.indexes) {
      this.indexes[k].index.clear();
    }
    for (const k in this.indexesDerived) {
      this.indexesDerived[k].index.clear();
    }
    this.rowCounter = new Counter(0);
  }

  public getIndex(
    k: keyof R | Array<keyof R>,
  ): ReadonlyMap<any, ReadonlySet<number>> | undefined {
    if (Array.isArray(k)) {
      return this.indexesDerived[k.join('')].index;
    } else {
      return this.indexes[k as string].index;
    }
  }

  public hasRow(rI: number): boolean {
    return this.rows.has(rI);
  }

  public getRow(rI: number): Readonly<R> | undefined {
    return this.rows.get(rI);
  }

  /**
   * Will perform a shallow copy before setting.
   */
  public setRow(rI: number, rowNew: R): void {
    const rowOld = this.rows.get(rI);
    if (rowOld == null) {
      this.rowCounter.allocate(rI);
      this.rows.set(rI, { ...rowNew });
      this.insertIndex(rI, rowNew);
    } else {
      this.rows.set(rI, { ...rowNew });
      this.removeIndex(rI, rowOld);
      this.insertIndex(rI, rowNew);
    }
  }

  /**
   * Will perform a shallow copy before updating.
   */
  public updateRow(rI: number, r: Partial<R>): void {
    const rowOld = this.rows.get(rI);
    if (rowOld == null) {
      throw new RangeError(`Row ${rI} does not exist`);
    }
    const rowNew = {
      ...rowOld,
      ...r,
    };
    this.rows.set(rI, rowNew);
    this.removeIndex(rI, rowOld);
    this.insertIndex(rI, rowNew);
  }

  public deleteRow(rI: number): void {
    const r = this.rows.get(rI);
    if (r == null) return;
    this.rowCounter.deallocate(rI);
    this.rows.delete(rI);
    this.removeIndex(rI, r);
  }

  /**
   * Will perfrom a shallow copy before inserting.
   */
  public insertRow(r: R): number {
    const rI = this.rowCounter.allocate();
    this.rows.set(rI, { ...r });
    this.insertIndex(rI, r);
    return rI;
  }

  public whereRows(k: string, v: any, search?: boolean): Array<number>;
  public whereRows(
    k: Array<string>,
    v: Array<any>,
    search?: boolean,
  ): Array<number>;
  public whereRows(
    k: string | Array<string>,
    v: any | Array<any>,
    search: boolean = false,
  ): Array<number> {
    if (!Array.isArray(k)) {
      if (!this.keys.has(k)) {
        throw new RangeError(`Key \`${k}\` does not exist`);
      }
      const index = this.indexes[k];
      if (index != null) {
        const v_ = index.f != null ? index.f(v) : utils.toString(v);
        return [...(index.index.get(v_) ?? new Set())];
      } else if (search) {
        const v_ = utils.toString(v);
        const rIs: Array<number> = [];
        for (const [rI, r] of this.rows.entries()) {
          if (r[k] === v_) {
            rIs.push(rI);
          }
        }
        return rIs;
      } else {
        throw new RangeError(`Key \`${k}\` is not indexed`);
      }
    } else {
      if (!k.every((k) => this.keys.has(k))) {
        throw new RangeError(`Keys \`${k}\` has a key that does not exist`);
      }
      const kDerived = k.join('');
      const index = this.indexesDerived[kDerived];
      if (index != null) {
        const v_ =
          index.f != null
            ? index.f(...v)
            : v.map((v) => utils.toString(v)).join('');
        return [...(index.index.get(v_) ?? new Set())];
      } else if (search) {
        const v_ = v.map((v) => utils.toString(v)).join('');
        const rIs: Array<number> = [];
        for (const [rI, r] of this.rows.entries()) {
          if (k.map((k) => utils.toString(r[k])).join('') === v_) {
            rIs.push(rI);
          }
        }
        return rIs;
      } else {
        throw new RangeError(`Keys \`${k}\` is not indexed`);
      }
    }
  }

  protected insertIndex(rI: number, r: R) {
    // Insert into singular index
    for (const k in r) {
      const index = this.indexes[k];
      if (index == null) continue;
      const v = index.f != null ? index.f(r[k]) : utils.toString(r[k]);
      const rIs = index.index.get(v) ?? new Set();
      rIs.add(rI);
      index.index.set(v, rIs);
    }
    // Insert into derived index
    const kDerivedSetProcessed = new Set();
    for (const k in r) {
      const kDerivedSet = this.indexesDerivedDeps[k];
      if (kDerivedSet == null) continue;
      for (const kDerived of kDerivedSet) {
        if (kDerivedSetProcessed.has(kDerived)) continue;
        const index = this.indexesDerived[kDerived];
        let v;
        if (index.f != null) {
          v = index.f(...index.deps.map((k) => r[k]));
        } else {
          v = index.deps
            .map((k) => r[k])
            .map((v) => utils.toString(v))
            .join('');
        }
        const rIs = index.index.get(v) ?? new Set();
        rIs.add(rI);
        index.index.set(v, rIs);
        kDerivedSetProcessed.add(kDerived);
      }
    }
  }

  protected removeIndex(rI: number, r: R) {
    // Remove from singular index
    for (const k in r) {
      const index = this.indexes[k];
      if (index == null) continue;
      const v = index.f != null ? index.f(r[k]) : utils.toString(r[k]);
      const rIs = index.index.get(v)!;
      rIs.delete(rI);
      if (rIs.size === 0) {
        index.index.delete(v);
      }
    }
    // Remove from derived index
    const kDerivedSetProcessed = new Set();
    for (const k in r) {
      const kDerivedSet = this.indexesDerivedDeps[k];
      if (kDerivedSet == null) continue;
      for (const kDerived of kDerivedSet) {
        if (kDerivedSetProcessed.has(kDerived)) continue;
        const index = this.indexesDerived[kDerived];
        let v;
        if (index.f != null) {
          v = index.f(...index.deps.map((k) => r[k]));
        } else {
          v = index.deps
            .map((k) => r[k])
            .map((v) => utils.toString(v))
            .join('');
        }
        const rIs = index.index.get(v)!;
        rIs.delete(rI);
        if (rIs.size === 0) {
          index.index.delete(v);
        }
        kDerivedSetProcessed.add(kDerived);
      }
    }
  }
}

export default Table;
