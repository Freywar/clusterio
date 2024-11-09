
export type ForceName = string;
export type ChunkCoordinate = number;
export type EntityName = string;
export type ItemName = string;

export class ChunkMap<EntryName extends string> {
	private _entries: Map<ForceName, Map<ChunkCoordinate, Map<ChunkCoordinate, Map<EntryName, number>>>> = new Map();
	private _shapshot: Map<ForceName, Map<ChunkCoordinate, Map<ChunkCoordinate, Map<EntryName, number>>>> = new Map();
	private _dirty: boolean = false;

	constructor(data?: [ForceName, ChunkCoordinate, ChunkCoordinate, EntryName, number][]) {
		for (const [force, cx, cy, name, count] of data ?? []) {
			this.set(force, cx, cy, name, count);
		}
	}

	serialize() {
		return [...this];
	}

	get(force: ForceName, cx: ChunkCoordinate, cy: ChunkCoordinate, name: EntryName): number {
		return this._entries.get(force)?.get(cx)?.get(cy)?.get(name) ?? 0;
	}

	set(force: ForceName, cx: ChunkCoordinate, cy: ChunkCoordinate, name: EntryName, count: number) {
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
	};

	update(force: ForceName, cx: ChunkCoordinate, cy: ChunkCoordinate, name: EntryName, update: (c: number) => number) {
		this.set(force, cx, cy, name, update(this.get(force, cx, cy, name)));
	};

	remove(force: ForceName, cx: ChunkCoordinate, cy: ChunkCoordinate, name: EntryName) {
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
	};

	clear() {
		this._entries = new Map();
		this._dirty = true;
	};

	get dirty(): boolean {
		return this._dirty;
	}

	get size() {
		return [...this].length;
	}

	* keys(): IterableIterator<[ForceName, ChunkCoordinate, ChunkCoordinate, EntryName]> {
		for (let [force, chunks] of this._entries) {
			for (let [x, cols] of chunks) {
				for (let [y, items] of cols) {
					for (let [name] of items) {
						yield [force, x, y, name];
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

	* entries(): IterableIterator<[ForceName, ChunkCoordinate, ChunkCoordinate, EntryName, number]> {
		for (let [force, chunks] of this._entries) {
			for (let [x, cols] of chunks) {
				for (let [y, items] of cols) {
					for (let [name, count] of items) {
						yield [force, x, y, name, count];
					}
				}
			}
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}
