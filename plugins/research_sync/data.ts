export type ForceName = string;
export type TechName = string;

// Normalized level starting from 0, e.g. `automation` in progress is `0.3`, unlocked `automation` is `1`,
// `mining-productivity-4` level 8 in progress is `7.3`, and `mining-productivity-4` level 8 unlocked is `8`.
export type TechLevel = number;

export type Key = [ForceName, TechName];
export type Entry = [...Key, TechLevel];

export class TechDatabase {
	private _data: Map<ForceName, Map<TechName, TechLevel>> = new Map();

	dirty: boolean = false;

	constructor(entries: TechDatabase | Entry[] = []) {
		for (let [force, tech, level] of entries) {
			this.set(force, tech, level);
		}
	}

	has(...[force, tech]: Key): boolean {
		return this.get(force, tech) >= 0;
	}

	get(...[force, tech]: Key): TechLevel {
		return this._data.get(force)?.get(tech) ?? -1;
	}

	set(...[force, tech, level]: Entry): TechDatabase {
		let m: Map<unknown, Map<unknown, unknown>> = this._data;
		m.set(force, m = m.get(force) ?? new Map());
		(m as unknown as Map<unknown, TechLevel>).set(tech, level);
		this.dirty = true;
		return this;
	}

	update(...[force, tech, f]: [...Key, (level: TechLevel) => TechLevel]): TechDatabase {
		return this.set(force, tech, f(this.get(force, tech)));
	}

	delete(...[force, tech]: Key): boolean {
		if (!this.has(force, tech)) {
			return false;
		}
		this._data?.get(force)?.delete(tech);
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
		for (const [force, techs] of this._data) {
			for (const [tech, level] of techs) {
				yield [force, tech, level];
			}
		}
	}


	* keys(): IterableIterator<Key> {
		for (const [force, techs] of this._data) {
			for (const [tech] of techs) {
				yield [force, tech];
			}
		}
	}

	* values(): IterableIterator<TechLevel> {
		for (const techs of this._data.values()) {
			for (const level of techs.values()) {
				yield level;
			}
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}
