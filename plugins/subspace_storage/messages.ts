import * as lib from "@clusterio/lib";
import { Static, Type } from "@sinclair/typebox";
import { EntityName, ForceName, ItemName } from "./data";

export class Count<EntryName extends string> {
	constructor(
		public readonly force: ForceName,
		public readonly cx: number,
		public readonly cy: number,
		public readonly name: EntryName,
		public readonly count: number,
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
		return [this.force, this.cx, this.cy, this.name, this.count];
	}

	static fromJSON<EntryName extends string>(json: Static<typeof Count.jsonSchema>): Count<EntryName> {
		return new Count(...json) as Count<EntryName>;
	}
}

export class Delta<EntryName extends string> extends Count<EntryName> {
	static fromJSON<EntryName extends string>(json: Static<typeof Delta.jsonSchema>): Delta<EntryName> {
		return new Count(...json) as Delta<EntryName>;
	}
}

export class ManageSubscriptionRequest {
	declare ["constructor"]: typeof ManageSubscriptionRequest;
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

	static fromJSON({ subscribe }: Static<typeof ManageSubscriptionRequest.jsonSchema>): ManageSubscriptionRequest {
		return new this(subscribe);
	}
}

export class GetEndpointsRequest {
	declare ["constructor"]: typeof GetEndpointsRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;
	static Response = lib.jsonArray(Count<EntityName>);
}

export class PlaceEndpointsEvent {
	declare ["constructor"]: typeof PlaceEndpointsEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public endpoints: Delta<EntityName>[]
	) {
	}

	static jsonSchema = Type.Object({
		"endpoints": Type.Array(Delta.jsonSchema),
	});

	static fromJSON({ endpoints }: Static<typeof PlaceEndpointsEvent.jsonSchema>): PlaceEndpointsEvent {
		return new this(endpoints.map(endpoint => Delta.fromJSON(endpoint)));
	}
}

export class UpdateEndpointsEvent {
	declare ["constructor"]: typeof UpdateEndpointsEvent;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public endpoints: Delta<EntityName>[]
	) {
	}

	static jsonSchema = Type.Object({
		"endpoints": Type.Array(Delta.jsonSchema),
	});

	static fromJSON({ endpoints }: Static<typeof UpdateEndpointsEvent.jsonSchema>): UpdateEndpointsEvent {
		return new this(endpoints.map(endpoint => Delta.fromJSON(endpoint)));
	}
}

export class GetStorageRequest {
	declare ["constructor"]: typeof GetStorageRequest;
	static type = "request" as const;
	static src = ["instance", "control"] as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;
	static permission = "subspace_storage.storage.view" as const;
	static Response = lib.jsonArray(Count<ItemName>);
}

export class TransferItemsRequest {
	declare ["constructor"]: typeof TransferItemsRequest;
	static type = "request" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Delta<ItemName>[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Delta.jsonSchema),
	});

	static fromJSON({ items }: Static<typeof TransferItemsRequest.jsonSchema>): TransferItemsRequest {
		return new this(items.map(item => Delta.fromJSON(item)));
	}

	static Response = lib.jsonArray(Delta<ItemName>);
}

export class UpdateStorageEvent {
	declare ["constructor"]: typeof UpdateStorageEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = ["instance", "control"] as const;
	static plugin = "subspace_storage" as const;

	constructor(
		public items: Count<ItemName>[]
	) {
	}

	static jsonSchema = Type.Object({
		"items": Type.Array(Count.jsonSchema),
	});

	static fromJSON({ items }: Static<typeof UpdateStorageEvent.jsonSchema>): UpdateStorageEvent {
		return new this(items.map(item => Count.fromJSON(item)));
	}
}
