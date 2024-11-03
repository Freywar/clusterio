export type ForceName = string;
export type TechnologyName = string;

export type Technology = {
	level: number,
	progress: number | null,
	researched: boolean,
}

export class TechnologyMap {
	private _entries: Map<ForceName, Map<TechnologyName, Technology>> = new Map();
	private _dirty: boolean = false;

	constructor(data?: object) {
		if (data) {
			for (const [force, techs] of Object.entries(data)) {
				this._entries.set(force, new Map());
				for (const [name, tech] of techs) {
					this._entries.get(force)!.set(name, tech);
				}
			}
		}
	}

	serialize() {
		let result: Record<ForceName, Record<TechnologyName, Technology>> = {};
		for (const [force, items] of this._entries) {
			result[force] = {};
			for (const [name, item] of items) {
				result[force][name] = item;
			}
		}
		return result;
	}

	get(force: ForceName, name: TechnologyName): Technology | null {
		return this._entries.get(force)?.get(name) ?? null;
	}

	set(force: ForceName, name: string, item: Technology) {
		if (!this._entries.has(force)) {
			this._entries.set(force, new Map());
		}
		this._entries.get(force)?.set(name, item);
		this._dirty = true;
	};

	update(force: ForceName, name: TechnologyName, update: (v: Technology | null) => Technology | null) {
		let newItem = update(this._entries.get(force)?.get(name) || null);
		if (newItem) {
			this.set(force, name, newItem);
		} else {
			this.remove(force, name);
		}
	};

	remove(force: ForceName, name: TechnologyName) {
		this._entries.get(force)?.delete(name);
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

	*keys(): IterableIterator<[ForceName, TechnologyName]> {
		for (let [force, items] of this._entries) {
			for (let [name] of items) {
				yield [force, name];
			}
		}
	}

	*values(): IterableIterator<Technology> {
		for (let items of this._entries.values()) {
			for (let item of items.values()) {
				yield item;
			}
		}
	}

	*entries(): IterableIterator<[ForceName, TechnologyName, Technology]> {
		for (let [force, items] of this._entries) {
			for (let [name, item] of items) {
				yield [force, name, item];
			}
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}
