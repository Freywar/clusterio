import * as lib from "@clusterio/lib";
import { Static, Type } from "@sinclair/typebox";
import { ChunkCoordinate, ForceName, ItemCount, ItemName } from "./data";

export class ItemPackage {
	constructor(
		public force: ForceName,
		public cx: ChunkCoordinate,
		public cy: ChunkCoordinate,
		public item: ItemName,
		public count: ItemCount
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
		return [this.force, this.cx, this.cy, this.item, this.count];
	}

	static fromJSON(json: Static<typeof ItemPackage.jsonSchema>): ItemPackage {
		return new this(...json);
	}
}

export class ReadItemsRequest {
	declare ["constructor"]: typeof ReadItemsRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;
	static Response = lib.jsonArray(ItemPackage);
}

export class WriteItemsEvent {
	declare ["constructor"]: typeof WriteItemsEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = ["instance", "control"] as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: ItemPackage[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(ItemPackage.jsonSchema),
	});

	static fromJSON({ items }: Static<typeof WriteItemsEvent.jsonSchema>): WriteItemsEvent {
		return new this(items.map(item => ItemPackage.fromJSON(item)));
	}
}

export class InjectItemsEvent {
	declare ["constructor"]: typeof InjectItemsEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: ItemPackage[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(ItemPackage.jsonSchema),
	});

	static fromJSON({ items }: Static<typeof InjectItemsEvent.jsonSchema>): InjectItemsEvent {
		return new this(items.map(item => ItemPackage.fromJSON(item)));
	}
}

export class ExtractItemsRequest {
	declare ["constructor"]: typeof ExtractItemsRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: ItemPackage[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(ItemPackage.jsonSchema),
	});

	static fromJSON({ items }: Static<typeof ExtractItemsRequest.jsonSchema>): ExtractItemsRequest {
		return new this(items.map(item => ItemPackage.fromJSON(item)));
	}

	static Response = lib.jsonArray(ItemPackage);
}

export class UpdateStorageSubscriptionRequest {
	declare ["constructor"]: typeof UpdateStorageSubscriptionRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;

	constructor(
		public subscribe: boolean
	) {
	}

	static jsonSchema = Type.Object({
		"subscribe": Type.Boolean(),
	});

	static fromJSON(
		json: Static<typeof UpdateStorageSubscriptionRequest.jsonSchema>): UpdateStorageSubscriptionRequest {
		return new this(json.subscribe);
	}
}
