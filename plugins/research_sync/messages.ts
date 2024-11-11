import * as lib from "@clusterio/lib";
import { Static, Type } from "@sinclair/typebox";
import { ForceName, TechLevel, TechName } from "./model";

export class TechResearch {
	constructor(
		public readonly force: ForceName,
		public readonly name: TechName,
		public readonly level: TechLevel,
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.String(),
		Type.Number(),
	]);

	toJSON() {
		return [this.force, this.name, this.level.absolute];
	}

	static fromJSON([force, name, level]: Static<typeof TechResearch.jsonSchema>): TechResearch {
		return new TechResearch(force, name, new TechLevel(level));
	}
}

export class TechAdvancement {
	constructor(
		public readonly force: ForceName,
		public readonly name: TechName,
		public readonly level: number,
		public readonly advancement: number,
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.String(),
		Type.Number(),
		Type.Number(),
	]);

	toJSON() {
		return [this.force, this.name, this.level, this.advancement];
	}

	static fromJSON(json: Static<typeof TechAdvancement.jsonSchema>): TechAdvancement {
		return new TechAdvancement(...json);
	}
}

export class SyncTechsRequest {
	declare ["constructor"]: typeof SyncTechsRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;

	constructor(
		public techs: TechResearch[]
	) {
	}

	static jsonSchema = Type.Object({
		"techs": Type.Array(TechResearch.jsonSchema),
	});

	static fromJSON({ techs }: Static<typeof SyncTechsRequest.jsonSchema>): SyncTechsRequest {
		return new this(techs.map(tech => TechResearch.fromJSON(tech)));
	}

	static Response = lib.jsonArray(TechResearch);
}

export class AdvanceTechEvent {
	declare ["constructor"]: typeof AdvanceTechEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;

	constructor(
		public techs: TechAdvancement[]
	) {
	}

	static jsonSchema = Type.Object({
		"techs": Type.Array(TechAdvancement.jsonSchema),
	});

	static fromJSON({ techs }: Static<typeof AdvanceTechEvent.jsonSchema>): AdvanceTechEvent {
		return new this(techs.map(tech => TechAdvancement.fromJSON(tech)));
	}
}

export class UpdateTechsEvent {
	declare ["constructor"]: typeof UpdateTechsEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "research_sync" as const;

	constructor(
		public techs: TechResearch[]
	) {
	}

	static jsonSchema = Type.Object({
		"techs": Type.Array(TechResearch.jsonSchema),
	});

	static fromJSON({ techs }: Static<typeof UpdateTechsEvent.jsonSchema>): UpdateTechsEvent {
		return new this(techs.map(tech => TechResearch.fromJSON(tech)));
	}
}
