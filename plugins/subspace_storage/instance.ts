import { BaseInstancePlugin } from "@clusterio/host";
import * as lib from "@clusterio/lib";

import { Entry } from "./data";
import {
	ExtractItemsRequest,
	InjectItemsEvent,
	ItemPackage,
	ReadItemsRequest,
	WriteItemsEvent,
} from "./messages";

type IpcItems = Entry[];

export class InstancePlugin extends BaseInstancePlugin {
	tasks: Set<Promise<unknown>> = new Set();
	ping?: ReturnType<typeof setTimeout>;

	private async track<T>(task: Promise<T>): Promise<T> {
		this.tasks.add(task);
		try {
			return await task;
		} finally {
			this.tasks.delete(task);
		}
	}

	private unexpectedError(err: Error) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	private async injectItems(items: IpcItems) {
		if (!this.host.connector.hasSession) {
			if (this.instance.config.get("subspace_storage.log_item_transfers")) {
				this.logger.verbose("Voided the following items:");
				this.logger.verbose(JSON.stringify(items));
			}
			return;
		}

		this.instance.sendTo("controller", new InjectItemsEvent(items.map(item => new ItemPackage(...item))));

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Exported the following to controller:");
			this.logger.verbose(JSON.stringify(items));
		}
	}

	private async extractItems(items: IpcItems) {
		const received = await this.instance.sendTo(
			"controller",
			new ExtractItemsRequest(items.map(item => new ItemPackage(...item)))
		);

		if (!received.length) {
			return;
		}

		if (this.instance.config.get("subspace_storage.log_item_transfers")) {
			this.logger.verbose("Imported the following from controller:");
			this.logger.verbose(JSON.stringify(received));
		}

		await this.sendRcon(
			`/sc __subspace_storage__ receive_items("${lib.escapeString(JSON.stringify(received))}")`,
			true
		);
	}

	private async handleWriteItemsEvent({ items }: WriteItemsEvent) {
		if (this.instance.status !== "running") {
			return;
		}

		await this.track(
			this.sendRcon(
				`/sc __subspace_storage__ update_inventory("${lib.escapeString(JSON.stringify(items))}")`,
				true)
		);
	}

	async init() {
		this.tasks = new Set();
		this.instance.server.on("ipc-subspace_storage:inject", (items: IpcItems) => {
			if (this.instance.status !== "running" || !this.host.connected) {
				return;
			}
			this.track(this.injectItems(items).catch(err => this.unexpectedError(err)));
		});
		this.instance.server.on("ipc-subspace_storage:extract", (orders: IpcItems) => {
			if (this.instance.status !== "running" || !this.host.connected) {
				return;
			}
			this.track(this.extractItems(orders).catch(err => this.unexpectedError(err)));
		});

		this.instance.handle(WriteItemsEvent, this.handleWriteItemsEvent.bind(this));
	}

	async onStart() {
		this.ping = setInterval(() => {
			if (!this.host.connected) {
				return; // Only ping if we are actually connected to the controller.
			}
			this.sendRcon(
				"/sc __subspace_storage__ global.ping_tick = game.tick", true
			).catch(err => this.unexpectedError(err));
		}, 5000);

		// TODO Diff with dump of invdata produce minimal command to sync
		await this.sendRcon(
			`/sc __subspace_storage__ update_inventory("${lib.escapeString(JSON.stringify(
				await this.instance.sendTo("controller", new ReadItemsRequest())
			))}", true)`,
			true
		);
	}

	async onStop() {
		clearInterval(this.ping);
		await Promise.all(this.tasks);
	}

	onExit() {
		clearInterval(this.ping);
	}


}
