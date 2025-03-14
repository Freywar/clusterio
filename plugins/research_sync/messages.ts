import * as lib from "@clusterio/lib";
import { Static, Type } from "@sinclair/typebox";
import { Entry, ForceName, TechLevel, TechName } from "./data";

export class Tech {
	constructor(
		public force: ForceName,
		public tech: TechName,
		public level: TechLevel,
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.String(),
		Type.Number(),
	]);

	toJSON(): Entry {
		return [this.force, this.tech, this.level];
	}

	static fromJSON(json: Static<typeof Tech.jsonSchema>): Tech {
		return new this(...json);
	}
}

export class TechProgress {
	constructor(
		public force: ForceName,
		public tech: TechName,
		public base: TechLevel,
		public delta: TechLevel,
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.String(),
		Type.Number(),
		Type.Number(),
	]);

	toJSON() {
		return [this.force, this.tech, this.base, this.delta];
	}

	static fromJSON(json: Static<typeof TechProgress.jsonSchema>): TechProgress {
		return new this(...json);
	}
}

export class ReadTechsRequest {
	declare ["constructor"]: typeof ReadTechsRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;
	static permission = "research_sync.technologies.view" as const;
	static Response = lib.jsonArray(Tech);
}

export class WriteTechsEvent {
	declare ["constructor"]: typeof WriteTechsEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "research_sync" as const;

	constructor(
		public techs: Tech[],
	) {
	}

	static jsonSchema = Type.Object({
		"techs": Type.Array(Tech.jsonSchema),
	});

	static fromJSON({ techs }: Static<typeof WriteTechsEvent.jsonSchema>): WriteTechsEvent {
		return new this(techs.map(tech => Tech.fromJSON(tech)));
	}
}

export class SyncTechsRequest {
	declare ["constructor"]: typeof SyncTechsRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;

	constructor(
		public techs: Tech[]
	) {
	}

	static jsonSchema = Type.Object({
		"techs": Type.Array(Tech.jsonSchema),
	});

	toJSON() {
		return { techs: this.techs.map(tech => tech.toJSON()) };
	}

	static fromJSON({ techs }: Static<typeof SyncTechsRequest.jsonSchema>): SyncTechsRequest {
		return new this(techs.map(tech => Tech.fromJSON(tech)));
	}

	static Response = lib.jsonArray(Tech);
}

export class ProgressTechsEvent {
	declare ["constructor"]: typeof ProgressTechsEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;

	constructor(
		public techs: TechProgress[]
	) {
	}

	static jsonSchema = Type.Object({
		"techs": Type.Array(TechProgress.jsonSchema),
	});

	static fromJSON({ techs }: Static<typeof ProgressTechsEvent.jsonSchema>): ProgressTechsEvent {
		return new this(techs.map(tech => TechProgress.fromJSON(tech)));
	}
}

export class UpdateDatabaseSubscriptionRequest {
	declare ["constructor"]: typeof UpdateDatabaseSubscriptionRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "research_sync" as const;
	static permission = "research_sync.technologies.view" as const;

	constructor(
		public subscribe: boolean
	) {
	}

	static jsonSchema = Type.Object({
		"subscribe": Type.Boolean(),
	});

	static fromJSON(
		json: Static<typeof UpdateDatabaseSubscriptionRequest.jsonSchema>): UpdateDatabaseSubscriptionRequest {
		return new this(json.subscribe);
	}
}
