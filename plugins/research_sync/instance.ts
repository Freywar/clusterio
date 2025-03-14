import { BaseInstancePlugin } from "@clusterio/host";
import * as lib from "@clusterio/lib";
import { Entry, TechDatabase, TechLevel } from "./data";
import { ProgressTechsEvent, SyncTechsRequest, Tech, TechProgress, WriteTechsEvent } from "./messages";

// ./module/sync.lua
type IpcTechs = Entry[];
type IpcProgress = [...Entry, TechLevel][];

export class InstancePlugin extends BaseInstancePlugin {
	initialized: boolean = false;

	private unexpectedError(err: Error) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	private async progressTechnology(progress: IpcProgress) {
		if (!this.host.connector.hasSession) {
			this.logger.warn("Voided the following technology progress:");
			this.logger.warn(JSON.stringify(progress));
			return;
		}

		this.instance.sendTo("controller", new ProgressTechsEvent(progress.map(tech => new TechProgress(...tech))));

		if (this.instance.config.get("research_sync.log_transfers")) {
			this.logger.verbose("Sent the following tehcnology progress to controller:");
			this.logger.verbose(JSON.stringify(progress));
		}
	}

	private async handleWriteTechsEvent({ techs }: WriteTechsEvent) {
		if (!this.initialized || !["starting", "running"].includes(this.instance.status)) {
			return;
		}

		await this.sendOrderedRcon(
			`/sc research_sync.write_techs("${lib.escapeString(JSON.stringify(techs))}")`,
			true,
		);
	}

	async init() {
		this.initialized = false;

		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("research_sync plugin requires save patching.");
		}

		this.instance.server.on("ipc-research_sync:progress", (progress: IpcProgress) => {
			this.progressTechnology(progress).catch(err => this.unexpectedError(err));
		});

		this.instance.handle(WriteTechsEvent, this.handleWriteTechsEvent.bind(this));
	}

	async onStart() {
		const instanceTechs = new TechDatabase(
			JSON.parse(await this.sendOrderedRcon("/sc research_sync.read_techs()")).techs,
		);

		const controllerTechs = new TechDatabase(
			(await this.instance.sendTo(
				"controller",
				new SyncTechsRequest([...instanceTechs].map((tech: Entry) => new Tech(...tech))),
			))
				.map(tech => tech.toJSON()),
		);

		const diff = new TechDatabase();
		for (const [force, tech, level] of controllerTechs) {
			if (instanceTechs.get(force, tech) < level) {
				diff.set(force, tech, level);
			}
		}

		if (!diff.empty) {
			await this.sendOrderedRcon(
				`/sc research_sync.write_techs("${lib.escapeString(JSON.stringify([...diff]))}")`,
				true,
			);
		}

		this.initialized = true;
	}
}
