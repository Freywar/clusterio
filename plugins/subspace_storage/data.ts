export type ForceName = string;
export type ChunkCoordinate = number;
export type ItemName = string;
export type ItemCount = number;

export type Key = [ForceName, ChunkCoordinate, ChunkCoordinate, ItemName];
export type Entry = [...Key, ItemCount];

export class ItemStorage {
	private _data: Map<ForceName, Map<ChunkCoordinate, Map<ChunkCoordinate, Map<ItemName, ItemCount>>>> = new Map();

	dirty: boolean = false;

	constructor(entries: ItemStorage | Entry[] = []) {
		for (let [force, cx, cy, item, count] of entries) {
			this.set(force, cx, cy, item, count);
		}
	}

	has(...[force, cx, cy, item]: Key): boolean {
		return this.get(force, cx, cy, item) !== 0;
	}

	get(...[force, cx, cy, item]: Key): ItemCount {
		return this._data.get(force)?.get(cx)?.get(cy)?.get(item) ?? 0;
	}

	set(...[force, cx, cy, item, value]: Entry): ItemStorage {
		if (!value) {
			this.delete(force, cx, cy, item);
		} else {
			let m: Map<unknown, Map<unknown, unknown>> = this._data;
			m.set(force, m = m.get(force) ?? new Map());
			m.set(cx, m = m.get(cx) ?? new Map());
			m.set(cy, m = m.get(cy) ?? new Map());
			(m as unknown as Map<unknown, ItemCount>).set(item, value);
		}
		this.dirty = true;
		return this;
	}

	update(...[force, cx, cy, item, f]: [...Key, (count: ItemCount) => ItemCount]): ItemStorage {
		return this.set(force, cx, cy, item, f(this.get(force, cx, cy, item)));
	}

	delete(...[force, cx, cy, item]: Key): boolean {
		if (!this.has(force, cx, cy, item)) {
			return false;
		}
		this._data?.get(force)?.get(cx)?.get(cy)?.delete(item);
		if (!this._data?.get(force)?.get(cx)?.get(cy)?.size) {
			this._data?.get(force)?.get(cx)?.delete(cy);
		}
		if (!this._data?.get(force)?.get(cx)?.size) {
			this._data?.get(force)?.delete(cx);
		}
		if (!this._data?.get(force)?.size) {
			this._data?.delete(force);
		}
		this.dirty = true;
		return true;
	}

	clear(): void {
		this._data = new Map();
		this.dirty = true;
	}

	get size(): number {
		return [...this].length;
	}

	get empty(): boolean {
		return !this._data.size;
	}

	* entries(): IterableIterator<Entry> {
		for (const [force, cxs] of this._data) {
			for (const [cx, cys] of cxs) {
				for (const [cy, items] of cys) {
					for (const [item, count] of items) {
						yield [force, cx, cy, item, count];
					}
				}
			}
		}
	}

	* keys(): IterableIterator<Key> {
		for (const [force, cxs] of this._data) {
			for (const [cx, cys] of cxs) {
				for (const [cy, items] of cys) {
					for (const [item] of items) {
						yield [force, cx, cy, item];
					}
				}
			}
		}
	}

	* values(): IterableIterator<ItemCount> {
		for (const cxs of this._data.values()) {
			for (const cys of cxs.values()) {
				for (const items of cys.values()) {
					for (const count of items.values()) {
						yield count;
					}
				}
			}
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}
