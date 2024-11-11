
export type ForceName = string;
export type ChunkCoordinate = number;
export type EntityName = string;
export type ItemName = string;

export type Key<EntryName extends string> = [ForceName, ChunkCoordinate, ChunkCoordinate, EntryName];
export type Entry<EntryName extends string> = [...Key<EntryName>, number];

export class ChunkMap<EntryName extends string> {
	private _entries: Map<ForceName, Map<ChunkCoordinate, Map<ChunkCoordinate, Map<EntryName, number>>>> = new Map();
	private _dirty: boolean = false;

	constructor(data?: Entry<EntryName>[]) {
		for (const entry of data ?? []) {
			this.set(...entry);
		}
	}

	serialize() {
		return [...this];
	}

	get(...[force, cx, cy, name]: Key<EntryName>): number {
		return this._entries.get(force)?.get(cx)?.get(cy)?.get(name) ?? 0;
	}

	set(...[force, cx, cy, name, count]: Entry<EntryName>) {
		if (!count) {
			this.remove(force, cx, cy, name);
		} else {
			if (!this._entries.has(force)) {
				this._entries.set(force, new Map());
			}
			if (!this._entries.get(force)!.has(cx)) {
				this._entries.get(force)!.set(cx, new Map());
			}
			if (!this._entries.get(force)!.get(cx)!.has(cy)) {
				this._entries.get(force)!.get(cx)!.set(cy, new Map());
			}
			this._entries.get(force)!.get(cx)!.get(cy)!.set(name, count);
		}
		this._dirty = true;
	}

	update(force: ForceName, cx: ChunkCoordinate, cy: ChunkCoordinate, name: EntryName, update: (c: number) => number) {
		this.set(force, cx, cy, name, update(this.get(force, cx, cy, name)));
	}

	remove(...[force, cx, cy, name]: Key<EntryName>) {
		this._entries.get(force)?.get(cx)?.get(cy)?.delete(name);
		if (!this._entries.get(force)?.get(cx)?.get(cy)?.size) {
			this._entries.get(force)?.get(cx)?.delete(cy);
		}
		if (!this._entries.get(force)?.get(cx)?.size) {
			this._entries.get(force)?.delete(cx);
		}
		if (!this._entries.get(force)?.size) {
			this._entries.delete(force);
		}
		this._dirty = true;
	}

	clear() {
		this._entries = new Map();
		this._dirty = true;
	}

	get dirty(): boolean {
		return this._dirty;
	}

	get size() {
		return [...this].length;
	}

	* keys(): IterableIterator<Key<EntryName>> {
		for (let [force, chunks] of this._entries) {
			for (let [cx, cols] of chunks) {
				for (let [cy, items] of cols) {
					for (let [name] of items) {
						yield [force, cx, cy, name];
					}
				}
			}
		}
	}

	* values(): IterableIterator<number> {
		for (let chunks of this._entries.values()) {
			for (let cols of chunks.values()) {
				for (let items of cols.values()) {
					for (let count of items.values()) {
						yield count;
					}
				}
			}
		}
	}

	* entries(): IterableIterator<Entry<EntryName>> {
		for (let [force, chunks] of this._entries) {
			for (let [cx, cols] of chunks) {
				for (let [cy, items] of cols) {
					for (let [name, count] of items) {
						yield [force, cx, cy, name, count];
					}
				}
			}
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}
