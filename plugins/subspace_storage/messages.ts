import { Type, Static } from "@sinclair/typebox";
import * as lib from "@clusterio/lib";

export class Entity {
	constructor(
		public force: string,
		public x: number,
		public y: number,
		public name: string,
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.Number(),
		Type.Number(),
		Type.String(),
	]);

	toJSON() {
		return [this.force, this.x, this.y];
	}

	static fromJSON(json: Static<typeof Entity.jsonSchema>): Entity {
		return new this(...json);
	}
}

export class PlaceEntitiesEvent {
	declare ["constructor"]: typeof PlaceEntitiesEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public entities: Entity[]
	) {
	}

	static jsonSchema = Type.Object({
		"entities": Type.Array(Entity.jsonSchema),
	});

	static fromJSON(json: Static<typeof PlaceEntitiesEvent.jsonSchema>): PlaceEntitiesEvent {
		return new this(json.entities.map(entity => Entity.fromJSON(entity)));
	}
}

export class Item {
	constructor(
		public force: string,
		public x: number,
		public y: number,
		public name: string,
		public count: number
	) {
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.Number(),
		Type.Number(),
		Type.String(),
		Type.Number(),
	]);

	toJSON() {
		return [this.force, this.x, this.y, this.count];
	}

	static fromJSON(json: Static<typeof Item.jsonSchema>): Item {
		return new this(...json);
	}
}

export class GetStorageRequest {
	declare ["constructor"]: typeof GetStorageRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;
	static Response = lib.jsonArray(Item);
}

export class PlaceItemsEvent {
	declare ["constructor"]: typeof PlaceItemsEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema),
	});

	static fromJSON(json: Static<typeof PlaceItemsEvent.jsonSchema>): PlaceItemsEvent {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}
}

export class RetrieveItemsRequest {
	declare ["constructor"]: typeof RetrieveItemsRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema),
	});

	static fromJSON(json: Static<typeof RetrieveItemsRequest.jsonSchema>): RetrieveItemsRequest {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}

	static Response = lib.jsonArray(Item);
}

export class SubscribeOnStorageRequest {
	declare ["constructor"]: typeof SubscribeOnStorageRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;

	constructor(
		public storage: boolean
	) {
	}

	static jsonSchema = Type.Object({
		"storage": Type.Boolean(),
	});

	static fromJSON(json: Static<typeof SubscribeOnStorageRequest.jsonSchema>): SubscribeOnStorageRequest {
		return new this(json.storage);
	}
}

export class UpdateStorageEvent {
	declare ["constructor"]: typeof UpdateStorageEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = ["instance", "control"] as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Item[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Item.jsonSchema),
	});

	static fromJSON(json: Static<typeof UpdateStorageEvent.jsonSchema>): UpdateStorageEvent {
		return new this(json.items.map(item => Item.fromJSON(item)));
	}
}
