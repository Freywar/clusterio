import { BaseInstancePlugin } from "@clusterio/host";
import * as lib from "@clusterio/lib";
import { EntityName, ItemName } from "./data";
import {
	Delta, GetEndpointsRequest, GetStorageRequest, TransferItemsRequest, UpdateEndpointsEvent, UpdateStorageEvent,
} from "./messages";


type IpcEndpoints = ConstructorParameters<typeof Delta<EntityName>>[];
type IpcItems = ConstructorParameters<typeof Delta<ItemName>>[];

export class InstancePlugin extends BaseInstancePlugin {
	pendingTasks!: Set<any>;
	pingId?: ReturnType<typeof setTimeout>;

	unexpectedError(err: Error) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		this.pendingTasks = new Set();
		this.instance.server.on("ipc-subspace_storage:place_endpoints", (endpoints: IpcEndpoints) => {
			this.placeEndpoints(endpoints).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-subspace_storage:transfer_items", (items: IpcItems) => {
			if (this.instance.status !== "running" || !this.host.connected) {
				return;
			}

			const task = this.transferItems(items).catch(err => this.unexpectedError(err));
			this.pendingTasks.add(task);
			task.finally(() => { this.pendingTasks.delete(task); });
		});

		this.instance.handle(UpdateEndpointsEvent, this.handleUpdateEndpointsEvent.bind(this));
		this.instance.handle(UpdateStorageEvent, this.handleUpdateStorageEvent.bind(this));
	}

	async onStart() {
		this.pingId = setInterval(() => {
			if (!this.host.connected) {
				return; // Only ping if we are actually connected to the controller.
			}
			this.sendRcon(
				"/sc __subspace_storage__ global.heartbeat_tick = game.tick", true
			).catch(err => this.unexpectedError(err));
		}, 5000);

		const endpoints = await this.instance.sendTo("controller", new GetEndpointsRequest());
		await this.sendRcon(
			`/sc __subspace_storage__ SetEndpoints("${lib.escapeString(JSON.stringify(endpoints))}")`, true
		);

		const storage = await this.instance.sendTo("controller", new GetStorageRequest());
		await this.sendRcon(
			`/sc __subspace_storage__ SetStorage("${lib.escapeString(JSON.stringify(storage))}")`, true
		);
	}

	async onStop() {
		clearInterval(this.pingId);
		await Promise.all(this.pendingTasks);
	}

	onExit() {
		clearInterval(this.pingId);
	}

	async placeEndpoints(endpoints: IpcEndpoints) {
		if (!this.host.connector.hasSession) {
			if (this.instance.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose("Ignored the following endpoints:");
				this.logger.verbose(JSON.stringify(endpoints));
			}
			return;
		}

		this.instance.sendTo("controller", new UpdateEndpointsEvent(endpoints.map(endpoint => new Delta(...endpoint))));

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Registered the following endpoints on controller:");
			this.logger.verbose(JSON.stringify(endpoints));
		}
	}

	async transferItems(items: IpcItems) {
		if (!this.host.connector.hasSession) {
			if (this.instance.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose("Voided the following items:");
				this.logger.verbose(JSON.stringify(items.filter(([, , , , count]) => count > 0)));
			}
			return;
		}

		const yields =
			await this.instance.sendTo("controller", new TransferItemsRequest(items.map(item => new Delta(...item))));

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Exported the following items to controller:");
			this.logger.verbose(JSON.stringify(items.filter(([, , , , count]) => count > 0)));
		}

		if (!yields.length) {
			return;
		}

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Imported following items from controller:");
			this.logger.verbose(JSON.stringify(yields));
		}

		await this.sendRcon(
			`/sc __subspace_storage__ ReceiveTransfer("${lib.escapeString(JSON.stringify(yields))}")`, true
		);
	}

	async handleUpdateEndpointsEvent({ endpoints }: UpdateEndpointsEvent) {
		if (this.instance.status !== "running") {
			return;
		}

		const task = this.sendRcon(
			`/sc __subspace_storage__ UpdateEndpoints("${lib.escapeString(JSON.stringify(endpoints))}")`, true
		);
		this.pendingTasks.add(task);
		await task.finally(() => { this.pendingTasks.delete(task); });
	}

	async handleUpdateStorageEvent({ items }: UpdateStorageEvent) {
		if (this.instance.status !== "running") {
			return;
		}

		const task = this.sendRcon(
			`/sc __subspace_storage__ UpdateStorage("${lib.escapeString(JSON.stringify(items))}")`, true
		);
		this.pendingTasks.add(task);
		await task.finally(() => { this.pendingTasks.delete(task); });
	}
}
