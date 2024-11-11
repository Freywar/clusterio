
export type ForceName = string;
export type TechName = string;

export type TechKey = [ForceName, TechName];
export type TechEntry = [...TechKey, TechLevel];

export class TechLevel {
	public absolute: number = 0;

	constructor(absolute: number);
	constructor(researched: number, progress: number);
	constructor(int: number, frac?: number) {
		this.absolute = int + (frac ?? 0);
	}


	public get researched(): number {
		return Math.floor(this.absolute);
	}

	public get researching(): number {
		return Math.ceil(this.absolute);
	}

	public get progress(): number {
		return this.absolute - this.researched;
	}
}

export class TechMap {
	private _entries: Map<ForceName, Map<TechName, TechLevel>> = new Map();
	private _dirty: boolean = false;

	constructor(data?: TechEntry[]) {
		for (const entry of data ?? []) {
			this.set(...entry);
		}
	}

	serialize() {
		return [...this];
	}

	get(...[force, name]: TechKey): TechLevel | undefined {
		return this._entries.get(force)?.get(name);
	}

	set(force: ForceName, name: TechName, progress: TechLevel | undefined) {
		if (!progress) {
			this.remove(force, name);
		} else {
			if (!this._entries.has(force)) {
				this._entries.set(force, new Map());
			}
			this._entries.get(force)!.set(name, progress);
		}
		this._dirty = true;
	}

	update(force: ForceName, name: TechName, update: (c: TechLevel | undefined) => TechLevel | undefined) {
		this.set(force, name, update(this.get(force, name)));
	}

	remove(...[force, name]: TechKey) {
		this._entries.get(force)?.delete(name);
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

	* keys(): IterableIterator<TechKey> {
		for (let [force, techs] of this._entries) {
			for (let [name] of techs) {
				yield [force, name];
			}
		}
	}

	* values(): IterableIterator<TechLevel> {
		for (let techs of this._entries.values()) {
			for (let progress of techs.values()) {
				yield progress;
			}
		}
	}

	* entries(): IterableIterator<TechEntry> {
		for (let [force, techs] of this._entries) {
			for (let [name, count] of techs) {
				yield [force, name, count];
			}
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}
