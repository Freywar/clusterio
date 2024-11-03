import { BaseControllerPlugin, type ControlConnection } from "@clusterio/controller";

import fs from "fs-extra";
import path from "path";

import * as lib from "@clusterio/lib";
const { Counter, Gauge } = lib;

import * as routes from "./routes";
import * as dole from "./dole";

import { StorageMap } from "./data";
import { Item, PlaceItemsEvent, RetrieveItemsRequest, GetStorageRequest, UpdateStorageEvent, SubscribeOnStorageRequest, PlaceEntitiesEvent, Entity } from "./messages";

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
	entities!: Set<Entity>;
	storage!: StorageMap;
	storageSnapshot!: StorageMap;
	broadcaster!: lib.RateLimiter;
	subscribers!: Set<ControlConnection>;
	doleMagicId!: ReturnType<typeof setInterval>;
	neuralDole!: dole.NeuralDole;

	private async load() {
		let storagePath = path.resolve(this.controller.config.get("controller.database_directory"), "storage.json");
		this.logger.verbose(`Loading ${storagePath}`);
		try {
			this.storage = new StorageMap(JSON.parse(await fs.readFile(storagePath, { encoding: "utf8" })));
			this.storageSnapshot = new StorageMap(this.storage.serialize());
		} catch (err: any) {
			if (err.code === "ENOENT") {
				this.logger.verbose("Creating new item database");
				return new StorageMap();
			}
			throw err;
		}
	}

	private async save() {
		if (this.storage.size < 50000) {
			let file = path.resolve(this.controller.config.get("controller.database_directory"), "storage.json");
			this.logger.verbose(`writing ${file}`);
			await lib.safeOutputFile(file, JSON.stringify(this.storage.serialize()));
		} else {
			this.logger.error(`Item database too large, not saving (${this.storage.size})`);
		}
	}

	async init() {
		this.entities = new Set();

		await this.load();

		this.broadcaster = new lib.RateLimiter({
			maxRate: 1,
			action: () => {
				try {
					this.broadcast();
				} catch (err: any) {
					this.logger.error(`Unexpected error sending storage update:\n${err.stack}`);
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

		this.controller.handle(PlaceEntitiesEvent, this.handlePlaceEntityEvent.bind(this));
		this.controller.handle(GetStorageRequest, this.handleGetStorageRequest.bind(this));
		this.controller.handle(PlaceItemsEvent, this.handlePlaceItemsEvent.bind(this));
		this.controller.handle(RetrieveItemsRequest, this.handleRetrieveItemsRequest.bind(this));
		this.controller.handle(SubscribeOnStorageRequest, this.handleSubscribeOnStorageRequest.bind(this));
	}

	broadcast() {
		if (this.entities.size) {
			let entities = PlaceEntitiesEvent.fromJSON({ entities: [...this.entities].map(e => [e.force, e.x, e.y, e.name]) });
			this.controller.sendTo("allInstances", entities);
			for (let link of this.subscribers) {
				link.send(entities);
			}
			this.entities = new Set();
		}


		let diff: StorageMap = new StorageMap();
		for (let [force, x, y, name, count] of this.storage) {
			if (this.storageSnapshot.get(force, x, y, name) !== count) {
				diff.set(force, x, y, name, count);
			}
		}

		if (diff.size) {
			let items = UpdateStorageEvent.fromJSON({ items: [...diff] });
			this.controller.sendTo("allInstances", items);
			for (let link of this.subscribers) {
				link.send(items);
			}
			this.storageSnapshot = new StorageMap(this.storage.serialize());
		}
	}

	async handlePlaceEntityEvent({ entities }: PlaceEntitiesEvent, { id: instanceId }: lib.Address) {
		for (let entity of entities) {
			this.entities.add(entity);
		}

		this.broadcaster.activate();

		if (this.controller.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose(
				`Broadcasted the following entities from ${instanceId}:\n${JSON.stringify(entities)}`
			);
		}
	}

	async handleGetStorageRequest() {
		return [...this.storage];
	}

	async handlePlaceItemsEvent({ items }: PlaceItemsEvent, { id: instanceId }: lib.Address) {
		for (let { force, x, y, name, count } of items) {
			this.storage.update(force, x, y, name, c => c + count);
			exportCounter.labels(String(instanceId), force, `${x}`, `${y}`, name).inc(count);
		}

		this.broadcaster.activate();

		if (this.controller.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose(
				`Imported the following from ${instanceId}:\n${JSON.stringify(items)}`
			);
		}
	}

	async handleRetrieveItemsRequest({ items }: RetrieveItemsRequest, { id: instanceId }: lib.Address) {
		let instanceName = this.controller.instances.get(instanceId)?.config.get("instance.name") ?? "unknown";

		let itemsRetrieved = [];
		switch (this.controller.config.get("subspace_storage.division_method")) {
			// Give out as much items as possible until there are 0 left.  This
			// might lead to one host getting all the items and the rest nothing.
			case "simple":
				for (let { force, x, y, name, count } of items) {
					let sent = Math.min(count, this.storage.get(force, x, y, name));
					if (sent > 0) {
						this.storage.update(force, x, y, name, c => c - sent);
						itemsRetrieved.push(new Item(force, x, y, name, sent));
					}
				}
				break;

			// use fancy neural net to calculate a "fair" dole division rate.
			case "neural_dole":
				for (let item of items) {
					let count = this.neuralDole.divider(
						{ ...item, instanceId, instanceName }
					);
					if (count > 0) {
						itemsRetrieved.push(new Item(item.force, item.x, item.y, item.name, count));
					}
				}
				break;

			// Use dole division. Makes it really slow to drain out the last little bit.
			case "dole":
				for (let item of items) {
					let count = dole.doleDivider({
						object: { ...item, instanceId, instanceName },
						items: this.storage,
						logItemTransfers: this.controller.config.get("subspace_storage.log_item_transfers"),
						logger: this.logger,
					});
					if (count > 0) {
						itemsRetrieved.push(new Item(item.force, item.x, item.y, item.name, count));
					}
				}
				break;

			// Should not be possible
			default:
				throw Error(`Unkown division_method ${this.controller.config.get("subspace_storage.division_method")}`);
		}

		if (itemsRetrieved.length) {
			for (let item of itemsRetrieved) {
				importCounter.labels(String(instanceId), item.name).inc(item.count);
			}

			this.broadcaster.activate();

			if (this.controller.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose(`Exported the following to ${instanceId}:\n${JSON.stringify(itemsRetrieved)}`);
			}
		}

		return itemsRetrieved;
	}

	async handleSubscribeOnStorageRequest(request: SubscribeOnStorageRequest, src: lib.Address) {
		let link = this.controller.wsServer.controlConnections.get(src.id)!;
		if (request.storage) {
			this.subscribers.add(link);
		} else {
			this.subscribers.delete(link);
		}
	}

	onControlConnectionEvent(connection: ControlConnection, event: string) {
		if (event === "close") {
			this.subscribers.delete(connection);
		}
	}

	async onMetrics() {
		for (let [force, x, y, name, count] of this.storage) {
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
