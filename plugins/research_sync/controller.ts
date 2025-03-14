import { BaseControllerPlugin, ControlConnection } from "@clusterio/controller";
import fs from "fs-extra";
import path from "path";

import * as lib from "@clusterio/lib";
const { RateLimiter } = lib;

import { TechDatabase } from "./data";
import {
	ProgressTechsEvent,
	ReadTechsRequest,
	SyncTechsRequest,
	Tech,
	UpdateDatabaseSubscriptionRequest,
	WriteTechsEvent,
} from "./messages";


export class ControllerPlugin extends BaseControllerPlugin {
	database: TechDatabase = new TechDatabase();
	diff: TechDatabase = new TechDatabase();
	broadcaster!: lib.RateLimiter;
	subscribedControlLinks: Set<ControlConnection> = new Set();

	private async load(): Promise<TechDatabase> {
		const file = path.resolve(this.controller.config.get("controller.database_directory"), "techs.json");
		this.logger.verbose(`Loading ${file}`);
		try {
			this.database = new TechDatabase(JSON.parse(await fs.readFile(file, { encoding: "utf8" })));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				this.logger.verbose("Creating new database");
				this.database = new TechDatabase();
			} else {
				throw err;
			}
		}
		this.diff = new TechDatabase();
		return this.database;
	}

	private async save() {
		const file = path.resolve(this.controller.config.get("controller.database_directory"), "techs.json");
		this.logger.verbose(`Writing ${file}`);
		await lib.safeOutputFile(file, JSON.stringify([...this.database]));
	}

	private broadcast() {
		if (this.diff.empty) {
			return;
		}
		const event = WriteTechsEvent.fromJSON({ techs: [...this.diff] });
		this.controller.sendTo("allInstances", event);
		for (const link of this.subscribedControlLinks) {
			link.send(event);
		}
		this.diff.clear();
	}

	private async handleReadTechsRequest() {
		return [...this.database];
	}


	private async handleSyncTechsRequest({ techs }: SyncTechsRequest): Promise<Tech[]> {
		for (const { force, tech, level } of techs) {
			if (this.database.get(force, tech) < level) {
				this.database.set(force, tech, level);
				this.diff.set(force, tech, level);
			}
		}

		this.broadcaster.activate();

		return [...this.database].map((tech) => new Tech(...tech));
	}

	private async handleProgressTechsEvent({ techs }: ProgressTechsEvent, { id: instance }: lib.Address) {
		for (const { force, tech, base, delta } of techs) {
			const current = this.database.get(force, tech);

			// We can't use progress made towards level N to progress towards level N+1: usually the latter costs much
			// more science packs. Using more expensive progress for cheaper levels is fair, though it means that one
			// instance is somehow ahead of the common level, and TODO should trigger a proper synchronization.
			if (Math.floor(current) > Math.floor(base)) {
				this.logger.warn(`Voided the following tech progress from ${instance}:`);
				this.logger.verbose(JSON.stringify({ force, tech, base, delta }));
				continue;
			}

			// For the same reason we can't progress over a level transition even if we have enough progress.
			const updated = Math.min(current + delta, Math.floor(current) + 1);

			const used = updated - current;
			if (used < delta) {
				this.logger.warn(`Voided the following tech progress from ${instance}:`);
				this.logger.verbose(JSON.stringify({ force, tech, base, delta: delta - used }));
			}

			if (used <= 0) {
				continue;
			}

			this.database.set(force, tech, updated);
			this.diff.set(force, tech, updated);
		}

		this.broadcaster.activate();

		if (this.controller.config.get("research_sync.log_transfers")) {
			this.logger.verbose(
				`Imported the following tech progress from ${instance}:\n${JSON.stringify(techs)}`
			);
		}
	}

	private async handleUpdateDatabaseSubscriptionRequest(
		{ subscribe }: UpdateDatabaseSubscriptionRequest,
		{ id: instance }: lib.Address
	) {
		this.subscribedControlLinks[subscribe ? "add" : "delete"](
			this.controller.wsServer.controlConnections.get(instance)!
		);
	}

	async init() {
		await this.load();

		this.broadcaster = new RateLimiter({
			maxRate: 1,
			action: () => this.broadcast(),
		});

		this.subscribedControlLinks = new Set();

		this.controller.handle(ReadTechsRequest,
			this.handleReadTechsRequest.bind(this));
		this.controller.handle(ProgressTechsEvent,
			this.handleProgressTechsEvent.bind(this));
		this.controller.handle(SyncTechsRequest,
			this.handleSyncTechsRequest.bind(this));
		this.controller.handle(UpdateDatabaseSubscriptionRequest,
			this.handleUpdateDatabaseSubscriptionRequest.bind(this));
	}

	onControlConnectionEvent(connection: ControlConnection, event: string) {
		if (event === "close") {
			this.subscribedControlLinks.delete(connection);
		}
	}

	async onSaveData() {
		if (this.database.dirty) {
			this.database.dirty = false;
			await this.save();
		}
	}

	async onShutdown() {
		this.broadcaster.cancel();
	}
}
