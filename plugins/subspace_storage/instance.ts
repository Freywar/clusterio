import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";

import {
	PlaceItemsEvent as AddItemsEvent,
	RetrieveItemsRequest as RemoveItemsRequest,
	GetStorageRequest,
	UpdateStorageEvent,
	Item,
	Entity,
	PlaceEntitiesEvent as BroadcastEndpointsEvent,
} from "./messages";

type IpcEndpoints = [string, number, number, string][];
type IpcItems = [string, number, number, string, number][];

export class InstancePlugin extends BaseInstancePlugin {
	pendingTasks!: Set<any>;
	pingId?: ReturnType<typeof setTimeout>;

	unexpectedError(err: Error) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		this.pendingTasks = new Set();
		this.instance.server.on("ipc-subspace_storage:broadcast_endpoints", (output: IpcEndpoints) => {
			this.broadcastEndpoints(output).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-subspace_storage:send_items", (items: IpcItems) => {
			this.sendItems(items).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-subspace_storage:request_items", (items: IpcItems) => {
			if (this.instance.status !== "running" || !this.host.connected) {
				return;
			}

			let task = this.requestItems(items).catch(err => this.unexpectedError(err));
			this.pendingTasks.add(task);
			task.finally(() => { this.pendingTasks.delete(task); });
		});

		this.instance.handle(BroadcastEndpointsEvent, this.handleBroadcastEndpointsEvent.bind(this));
		this.instance.handle(UpdateStorageEvent, this.handleUpdateStorageEvent.bind(this));
	}

	async onStart() {
		this.pingId = setInterval(() => {
			if (!this.host.connected) {
				return; // Only ping if we are actually connected to the controller.
			}
			this.sendRcon(
				"/sc __subspace_storage__ global.ticksSinceMasterPinged = 0", true
			).catch(err => this.unexpectedError(err));
		}, 5000);

		let items = await this.instance.sendTo("controller", new GetStorageRequest());
		await this.sendRcon(`/sc __subspace_storage__ SetStorage("${lib.escapeString(JSON.stringify(items))}")`, true);
	}

	async onStop() {
		clearInterval(this.pingId);
		await Promise.all(this.pendingTasks);
	}

	onExit() {
		clearInterval(this.pingId);
	}

	async broadcastEndpoints(entities: IpcEndpoints) {
		if (!this.host.connector.hasSession) {
			if (this.instance.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose("Ignored the following entities:");
				this.logger.verbose(JSON.stringify(entities));
			}
			return;
		}

		this.instance.sendTo("controller", new BroadcastEndpointsEvent(entities.map(item => new Entity(...item))));

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Exported the following entities to controller:");
			this.logger.verbose(JSON.stringify(entities));
		}
	}

	async sendItems(items: IpcItems) {
		if (!this.host.connector.hasSession) {
			if (this.instance.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose("Voided the following items:");
				this.logger.verbose(JSON.stringify(items));
			}
			return;
		}

		this.instance.sendTo("controller", new AddItemsEvent(items.map(item => new Item(...item))));

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Exported the following items to controller:");
			this.logger.verbose(JSON.stringify(items));
		}
	}

	async requestItems(requests: IpcItems) {
		let items = await this.instance.sendTo("controller", new RemoveItemsRequest(requests.map(item => new Item(...item))));

		if (!items.length) {
			return;
		}

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Imported following items from controller:");
			this.logger.verbose(JSON.stringify(items));
		}

		await this.sendRcon(`/sc __subspace_storage__ ReceiveItems("${lib.escapeString(JSON.stringify(items))}")`, true);
	}

	async handleBroadcastEndpointsEvent({ entities }: BroadcastEndpointsEvent) {
		if (this.instance.status !== "running") {
			return;
		}

		let task = this.sendRcon(`/sc __subspace_storage__ ReceiveEndpoints("${lib.escapeString(JSON.stringify(entities))}")`, true);
		this.pendingTasks.add(task);
		await task.finally(() => { this.pendingTasks.delete(task); });
	}

	async handleUpdateStorageEvent({ items }: UpdateStorageEvent) {
		if (this.instance.status !== "running") {
			return;
		}

		let task = this.sendRcon(`/sc __subspace_storage__ UpdateStorage("${lib.escapeString(JSON.stringify(items))}")`, true);
		this.pendingTasks.add(task);
		await task.finally(() => { this.pendingTasks.delete(task); });
	}
}
