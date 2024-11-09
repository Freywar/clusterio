import { BaseControllerPlugin, type ControlConnection } from "@clusterio/controller";

import fs from "fs-extra";
import path from "path";

import * as lib from "@clusterio/lib";
const { Counter, Gauge } = lib;

import * as dole from "./dole";
import * as routes from "./routes";

import { ChunkMap, EntityName, ItemName } from "./data";
import {
	Delta, GetStorageRequest, ManageSubscriptionRequest, PlaceEndpointsEvent, TransferItemsRequest,
	UpdateEndpointsEvent, UpdateStorageEvent,
} from "./messages";

const exportCounter = new Counter(
	"clusterio_subspace_storage_export_total",
	"Resources exported by instance",
	{ labels: ["instance_id", "resource"] }
);
const importCounter = new Counter(
	"clusterio_subspace_storage_import_total",
	"Resources imported by instance",
	{ labels: ["instance_id", "resource"] }
);
const controllerInventoryGauge = new Gauge(
	"clusterio_subspace_storage_controller_inventory",
	"Amount of resources stored on controller",
	{ labels: ["resource"] }
);

export class ControllerPlugin extends BaseControllerPlugin {
	endpoints!: ChunkMap<EntityName>;
	endpointsSnapshot!: ChunkMap<EntityName>;
	storage!: ChunkMap<ItemName>;
	storageSnapshot!: ChunkMap<ItemName>;
	broadcaster!: lib.RateLimiter;
	subscribers!: Set<ControlConnection>;
	doleMagicId!: ReturnType<typeof setInterval>;
	neuralDole!: dole.NeuralDole;

	private async load() {
		// TODO Better re-scan them on startup/instance connection.
		const endpointsPath =
			path.resolve(this.controller.config.get("controller.database_directory"), "endpoints.json");
		this.logger.verbose(`Loading ${endpointsPath}`);
		try {
			this.endpoints = new ChunkMap(JSON.parse(await fs.readFile(endpointsPath, { encoding: "utf8" })));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				this.logger.verbose("Failed to load endpoints, resetting the map");
				this.endpoints = new ChunkMap();
				this.endpointsSnapshot = new ChunkMap();
			}
			throw err;
		}

		const storagePath =
			path.resolve(this.controller.config.get("controller.database_directory"), "storage.json");
		this.logger.verbose(`Loading ${storagePath}`);
		try {
			this.storage = new ChunkMap(JSON.parse(await fs.readFile(storagePath, { encoding: "utf8" })));
			this.storageSnapshot = new ChunkMap(this.storage.serialize());
		} catch (err: any) {
			if (err.code === "ENOENT") {
				this.logger.verbose("Creating new item database");
				this.storage = new ChunkMap();
				this.storageSnapshot = new ChunkMap();
			}
			throw err;
		}
	}

	private async save() {
		const endpointPath = path.resolve(this.controller.config.get("controller.database_directory"), "storage.json");
		this.logger.verbose(`Writing endpoints to ${endpointPath}`);
		await lib.safeOutputFile(endpointPath, JSON.stringify(this.endpoints.serialize()));

		const storagePath = path.resolve(this.controller.config.get("controller.database_directory"), "storage.json");
		this.logger.verbose(`Writing storage to ${storagePath}`);
		await lib.safeOutputFile(storagePath, JSON.stringify(this.storage.serialize()));
	}

	async init() {
		this.endpoints = new ChunkMap();
		this.storage = new ChunkMap();
		this.storageSnapshot = new ChunkMap();

		await this.load();

		this.broadcaster = new lib.RateLimiter({
			maxRate: 1,
			action: () => {
				try {
					this.broadcast();
				} catch (err: any) {
					this.logger.error(`Unexpected error sending updates:\n${err.stack}`);
				}
			},
		});

		this.subscribers = new Set();

		this.neuralDole = new dole.NeuralDole({ storage: this.storage });
		this.doleMagicId = setInterval(() => {
			if (this.controller.config.get("subspace_storage.division_method") === "neural_dole") {
				this.neuralDole.doMagic();
			}
		}, 1000);

		routes.addApiRoutes(this.controller.app, this.storage);

		this.controller.handle(ManageSubscriptionRequest, this.handleManageSubscriptionRequest.bind(this));
		this.controller.handle(GetStorageRequest, this.handleGetEndpointsRequest.bind(this));
		this.controller.handle(PlaceEndpointsEvent, this.handlePlaceEndpointsEvent.bind(this));
		this.controller.handle(GetStorageRequest, this.handleGetStorageRequest.bind(this));
		this.controller.handle(TransferItemsRequest, this.handleTransferItemsRequest.bind(this));
	}

	broadcast() {
		if (this.endpoints.size) {
			// TODO Only send the diff.
			const event = UpdateEndpointsEvent.fromJSON({ endpoints: [...this.endpoints] });
			this.controller.sendTo("allInstances", event);
			for (const subscriber of this.subscribers) {
				subscriber.send(event);
			}
		}

		const diff: ChunkMap<ItemName> = new ChunkMap();
		for (const key of this.storage.keys()) {
			if (this.storageSnapshot.get(...key) !== this.storage.get(...key)) {
				diff.set(...key, this.storage.get(...key));
			}
		}

		if (diff.size) {
			const event = UpdateStorageEvent.fromJSON({ items: [...diff] });
			this.controller.sendTo("allInstances", event);
			for (const subscriber of this.subscribers) {
				subscriber.send(event);
			}
			this.storageSnapshot = new ChunkMap(this.storage.serialize());
		}
	}

	async handleManageSubscriptionRequest({ subscribe }: ManageSubscriptionRequest, src: lib.Address) {
		this.subscribers[subscribe ? "add" : "delete"](this.controller.wsServer.controlConnections.get(src.id)!);
	}

	async handleGetEndpointsRequest() {
		return [...this.endpoints];
	}

	async handlePlaceEndpointsEvent({ endpoints }: UpdateEndpointsEvent, { id: instanceId }: lib.Address) {
		for (const { force, cx, cy, name, count } of endpoints) {
			this.endpoints.update(force, cx, cy, name, c => c + count);
		}

		this.broadcaster.activate();

		if (this.controller.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose(
				`Received the following endpoint changes from ${instanceId}:\n${JSON.stringify(endpoints)}`
			);
		}
	}

	async handleGetStorageRequest() {
		return [...this.storage];
	}

	async handleTransferItemsRequest({ items }: TransferItemsRequest, { id: instanceId }: lib.Address) {
		const instanceName = this.controller.instances.get(instanceId)?.config.get("instance.name") ?? "unknown";

		const received = items.filter(({ count }) => count > 0);
		for (const { force, cx, cy, name, count } of received) {
			this.storage.update(force, cx, cy, name, c => c + count);
		}

		const requested = items.filter(({ count }) => count < 0);
		const sent = [];
		switch (this.controller.config.get("subspace_storage.division_method")) {
			// Give out as much items as possible until there are 0 left. This
			// might lead to one host getting all the items and the rest nothing.
			case "simple":
				for (const { force, cx, cy, name, count } of requested) {
					const delta = Math.min(-count, this.storage.get(force, cx, cy, name));
					if (delta > 0) {
						this.storage.update(force, cx, cy, name, c => c - delta);
						sent.push(new Delta(force, cx, cy, name, delta));
					}
				}
				break;

			// Use fancy neural net to calculate a "fair" dole division rate.
			case "neural_dole":
				for (const { force, cx, cy, name, count } of requested) {
					const delta =
						this.neuralDole.divider({ force, cx, cy, name, count: -count, instanceId, instanceName });
					if (delta > 0) {
						this.storage.update(force, cx, cy, name, c => c - delta);
						sent.push(new Delta(force, cx, cy, name, delta));
					}
				}
				break;

			// Use dole division. Makes it really slow to drain out the last little bit.
			case "dole":
				for (const { force, cx, cy, name, count } of requested) {
					const delta = dole.doleDivider({
						object: { force, cx, cy, name, count: -count, instanceId, instanceName },
						items: this.storage,
						logItemTransfers: this.controller.config.get("subspace_storage.log_item_transfers"),
						logger: this.logger,
					});
					if (delta > 0) {
						this.storage.update(force, cx, cy, name, c => c - delta);
						sent.push(new Delta(force, cx, cy, name, delta));
					}
				}
				break;

			// Should not be possible
			default:
				throw Error(`Unkown division_method ${this.controller.config.get("subspace_storage.division_method")}`);
		}

		if (received.length || sent.length) {
			this.broadcaster.activate();
		}

		if (received.length) {
			for (const { name, count } of received) {
				exportCounter.labels(String(instanceId), name).inc(count);
			}

			if (this.controller.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose(
					`Imported the following from ${instanceId}:\n${JSON.stringify(received)}`
				);
			}
		}

		if (sent.length) {
			for (const { name, count } of sent) {
				importCounter.labels(String(instanceId), name).inc(count);
			}
			if (this.controller.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose(
					`Exported the following to ${instanceId}:\n${JSON.stringify(sent)}`
				);
			}
		}

		// TODO This should also acknowledge items received.
		return sent;
	}


	onControlConnectionEvent(connection: ControlConnection, event: string) {
		if (event === "close") {
			this.subscribers.delete(connection);
		}
	}

	async onMetrics() {
		for (const [force, x, y, name, count] of this.storage) {
			controllerInventoryGauge.labels(force, `${x}`, `${y}`, name).set(count);
		}
	}

	async onSaveData() {
		await this.save();
	}

	async onShutdown() {
		this.broadcaster.cancel();
		clearInterval(this.doleMagicId);
	}
}
