export type ForceName = string;
export type ChunkCoordinate = number;
export type ItemName = string;

export class StorageMap {
	private _entries: Map<ForceName, Map<ChunkCoordinate, Map<ChunkCoordinate, Map<ItemName, number>>>> = new Map();
	private _dirty: boolean = false;

	constructor(data?: object) {
		if (data) {
			for (const [force, chunks] of Object.entries(data)) {
				this._entries.set(force, new Map());
				for (const [x, cols] of chunks) {
					this._entries.get(force)!.set(x, new Map());
					for (const [y, items] of cols) {
						this._entries.get(force)!.get(x)!.set(y, new Map());
						for (const [name, count] of items) {
							this._entries.get(force)!.get(x)!.get(y)!.set(name, count);
						}
					}
				}
			}
		}
	}

	serialize() {
		let result: Record<ForceName, Record<ChunkCoordinate, Record<ChunkCoordinate, Record<ItemName, number>>>> = {};
		for (const [force, chunks] of this._entries) {
			result[force] = {};
			for (const [x, cols] of chunks) {
				result[force][x] = {};
				for (const [y, items] of cols) {
					result[force][x][y] = {};
					for (const [name, count] of items) {
						result[force][x][y][name] = count;
					}
				}
			}
		}
		return result;
	}

	get(force: ForceName, x: ChunkCoordinate, y: ChunkCoordinate, name: string): number {
		return this._entries.get(force)?.get(x)?.get(y)?.get(name) ?? 0;
	}

	set(force: ForceName, x: ChunkCoordinate, y: ChunkCoordinate, name: string, count: number) {
		if (!count) {
			this.remove(force, x, y, name);
		}

		if (!this._entries.has(force)) {
			this._entries.set(force, new Map());
		}
		if (!this._entries.get(force)!.has(x)) {
			this._entries.get(force)!.set(x, new Map());
		}
		if (!this._entries.get(force)!.get(x)!.has(y)) {
			this._entries.get(force)!.get(x)!.set(y, new Map());
		}
		this._entries.get(force)!.get(x)!.has(y);
		this._dirty = true;
	};

	update(force: ForceName, x: ChunkCoordinate, y: ChunkCoordinate, name: string, update: (c: number) => number) {
		this.set(force, x, y, name, update(this.get(force, x, y, name)));
	};

	remove(force: ForceName, x: ChunkCoordinate, y: ChunkCoordinate, name: string,) {
		this._entries.get(force)?.get(x)?.get(y)?.delete(name);
		if (!this._entries.get(force)?.get(x)?.get(y)?.size) {
			this._entries.get(force)?.get(x)?.delete(y);
		}
		if (!this._entries.get(force)?.get(x)?.size) {
			this._entries.get(force)?.delete(x);
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
	
	*keys(): IterableIterator<[ForceName, ChunkCoordinate, ChunkCoordinate, ItemName]> {
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


	*values(): IterableIterator<number> {
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

	*entries(): IterableIterator<[ForceName, ChunkCoordinate, ChunkCoordinate, ItemName, number]> {
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
