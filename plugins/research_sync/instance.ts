import { BaseInstancePlugin } from "@clusterio/host";
import * as lib from "@clusterio/lib";
import {
	AdvanceTechEvent,
	FinishedEvent,
	SyncTechsRequest,
	TechnologySync,
	UpdateTechsEvent,
} from "./messages";

// ./module/sync.lua
type IpcContribution = {
	force: string,
	name: string,
	level: number,
	contribution: number,
};
type IpcFinished = {
	force: string,
	name: string,
	level: number,
};

export class InstancePlugin extends BaseInstancePlugin {
	syncStarted!: boolean;

	unexpectedError(err: Error) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("research_sync plugin requires save patching.");
		}

		this.instance.server.on("ipc-research_sync:send_advancement", (tech: IpcContribution) => {
			this.researchContribution(tech).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-research_sync:finished", (tech: IpcFinished) => {
			this.researchFinished(tech).catch(err => this.unexpectedError(err));
		});

		this.syncStarted = false;
		this.instance.handle(UpdateTechsEvent, this.handleProgressEvent.bind(this));
		this.instance.handle(FinishedEvent, this.handleFinishedEvent.bind(this));
	}

	async researchContribution({ force, name, level, contribution }: IpcContribution) {
		this.instance.sendTo("controller", new AdvanceTechEvent(force, name, level, contribution));
	}

	async handleProgressEvent(event: UpdateTechsEvent) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let techsJson = lib.escapeString(JSON.stringify(event.techs));
		await this.sendOrderedRcon(`/sc research_sync.update_progress("${techsJson}")`, true);
	}

	async researchFinished({ force, name, level }: IpcFinished) {
		this.instance.sendTo("controller", new FinishedEvent(force, name, level));
	}

	async handleFinishedEvent(event: FinishedEvent) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let { force, name, level } = event;
		await this.sendOrderedRcon(
			`/sc research_sync.research_technology("${lib.escapeString(force)}", "${lib.escapeString(name)}", ${level})`, true
		);
	}

	async onStart() {
		let dumpJson = await this.sendOrderedRcon("/sc research_sync.get_technologies()");
		let techsToSend = [];
		let instanceTechs = new Map();
		for (let tech of JSON.parse(dumpJson)) {
			techsToSend.push(new TechnologySync(
				tech.force,
				tech.name,
				tech.level,
				tech.progress || null,
				tech.researched,
			));
			(instanceTechs.get(tech.force) ?? instanceTechs.set(tech.force, new Map()).get(tech.force))!.set(tech.name, tech);
		}

		let controllerTechs = await this.instance.sendTo("controller", new SyncTechsRequest(techsToSend));
		this.syncStarted = true;
		let techsToSync = [];
		for (let controllerTech of controllerTechs) {
			let { force, name, full: level, partial: progress, researched } = controllerTech;
			let instanceTech = instanceTechs.get(force)?.get(name);
			if (
				!instanceTech
				|| instanceTech.level !== level
				|| (instanceTech.progress || null) !== progress
				|| instanceTech.researched !== researched
			) {
				techsToSync.push(controllerTech);
			}
		}

		if (techsToSync.length) {
			let syncJson = lib.escapeString(JSON.stringify(techsToSync));
			await this.sendOrderedRcon(`/sc research_sync.sync_technologies("${syncJson}")`, true);
		}
	}
}
