import { BaseControllerPlugin, type ControlConnection } from "@clusterio/controller";

import fs from "fs-extra";
import path from "path";

import * as lib from "@clusterio/lib";
const { Counter, Gauge } = lib;

import { ItemStorage } from "./data";
import {
	ExtractItemsRequest,
	InjectItemsEvent,
	ItemPackage,
	ReadItemsRequest,
	UpdateStorageSubscriptionRequest,
	WriteItemsEvent,
} from "./messages";
import * as routes from "./routes";

const exportCounter = new Counter(
	"clusterio_subspace_storage_export_total",
	"Resources exported by instance",
	{ labels: ["instance_id", "force", "endpoint", "resource"] }
);
const importCounter = new Counter(
	"clusterio_subspace_storage_import_total",
	"Resources imported by instance",
	{ labels: ["instance_id", "force", "endpoint", "resource"] }
);
const controllerInventoryGauge = new Gauge(
	"clusterio_subspace_storage_controller_inventory",
	"Amount of resources stored on controller",
	{ labels: ["force", "endpoint", "resource"] }
);


export class ControllerPlugin extends BaseControllerPlugin {
	storage: ItemStorage = new ItemStorage();
	diff: ItemStorage = new ItemStorage();
	broadcaster!: lib.RateLimiter;
	subscribedControlLinks: Set<ControlConnection> = new Set();

	private async load(): Promise<ItemStorage> {
		const file = path.resolve(this.controller.config.get("controller.database_directory"), "storage.json");
		this.logger.verbose(`Loading ${file}`);
		try {
			this.storage = new ItemStorage(JSON.parse(await fs.readFile(file, { encoding: "utf8" })));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				this.logger.verbose("Creating new storage");
				this.storage = new ItemStorage();
			} else {
				throw err;
			}
		}
		this.diff = new ItemStorage();
		return this.storage;
	}

	private async save() {
		const file = path.resolve(this.controller.config.get("controller.database_directory"), "storage.json");
		this.logger.verbose(`Writing ${file}`);
		await lib.safeOutputFile(file, JSON.stringify([...this.storage]));
	}

	private broadcast() {
		if (this.diff.empty) {
			return;
		}

		const event = WriteItemsEvent.fromJSON({ items: [...this.diff] });
		this.controller.sendTo("allInstances", event);
		for (const link of this.subscribedControlLinks) {
			link.send(event);
		}
		this.diff.clear();
	}

	private async handleReadItemsRequest() {
		return [...this.storage];
	}

	private async handleInjectItemsEvent({ items }: InjectItemsEvent, { id: instance }: lib.Address) {
		for (const { force, cx, cy, item, count } of items) {
			this.storage.update(force, cx, cy, item, c => c + count);
			this.diff.set(force, cx, cy, item, this.storage.get(force, cx, cy, item));
			exportCounter.labels(`${instance}`, force, `(${cx}, ${cy})`, item).inc(count);
		}

		this.broadcaster.activate();

		if (this.controller.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose(
				`Imported the following from ${instance}:\n${JSON.stringify(items)}`
			);
		}
	}

	private async handleExtractItemsRequest({ items }: ExtractItemsRequest, { id: instance }: lib.Address) {
		const actuals = [];
		for (const { force, cx, cy, item, count } of items) {
			const removable = Math.min(count, this.storage.get(force, cx, cy, item));
			if (removable > 0) {
				this.storage.update(force, cx, cy, item, c => c - removable);
				this.diff.set(force, cx, cy, item, this.storage.get(force, cx, cy, item));
				importCounter.labels(`${instance}`, force, `(${cx}, ${cy})`, item).inc(count);
				actuals.push(new ItemPackage(force, cx, cy, item, removable));
			}
		}

		if (!actuals.length) {
			return [];
		}

		this.broadcaster.activate();

		if (this.controller.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose(
				`Exported the following to ${instance}:\n${JSON.stringify(actuals)}`
			);
		}

		return actuals;
	}

	private async handleUpdateStorageSubscriptionRequest(
		{ subscribe }: UpdateStorageSubscriptionRequest,
		{ id: instance }: lib.Address
	) {
		this.subscribedControlLinks[subscribe ? "add" : "delete"](
			this.controller.wsServer.controlConnections.get(instance)!
		);
	}

	async init() {
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

		this.subscribedControlLinks = new Set();

		routes.addAPIRoutes(this.controller.app, this.storage);

		this.controller.handle(ReadItemsRequest,
			this.handleReadItemsRequest.bind(this));
		this.controller.handle(InjectItemsEvent,
			this.handleInjectItemsEvent.bind(this));
		this.controller.handle(ExtractItemsRequest,
			this.handleExtractItemsRequest.bind(this));
		this.controller.handle(UpdateStorageSubscriptionRequest,
			this.handleUpdateStorageSubscriptionRequest.bind(this));
	}

	onControlConnectionEvent(connection: ControlConnection, event: string) {
		if (event === "close") {
			this.subscribedControlLinks.delete(connection);
		}
	}

	async onMetrics() {
		for (const [force, cx, cy, item, count] of this.storage) {
			controllerInventoryGauge.labels(force, `(${cx}, ${cy})`, item).set(count);
		}
	}

	async onSaveData() {
		if (this.storage.dirty) {
			this.storage.dirty = false;
			await this.save();
		}
	}

	async onShutdown() {
		this.broadcaster.cancel();
	}
}
