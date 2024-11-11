import { BaseControllerPlugin } from "@clusterio/controller";
import fs from "fs-extra";
import path from "path";

import * as lib from "@clusterio/lib";
const { RateLimiter } = lib;

import { AdvanceTechEvent, SyncTechsRequest, TechResearch, UpdateTechsEvent } from "./messages";
import { TechMap } from "./model";

export class ControllerPlugin extends BaseControllerPlugin {
	techs!: TechMap;
	changedTechs!: TechMap;
	broadcaster!: lib.RateLimiter;

	private async load() {
		const techsPath =
			path.resolve(this.controller.config.get("controller.database_directory"), "techs.json");
		this.logger.verbose(`Loading ${techsPath}`);
		try {
			this.techs = new TechMap(JSON.parse(await fs.readFile(techsPath, { encoding: "utf8" })));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				this.logger.verbose("Failed to load techs, resetting the database");
				this.techs = new TechMap();
			}
			throw err;
		}
	}

	private async save() {
		const techsPath = path.resolve(this.controller.config.get("controller.database_directory"), "techs.json");
		this.logger.verbose(`Writing techs to ${techsPath}`);
		await lib.safeOutputFile(techsPath, JSON.stringify(this.techs.serialize()));
	}


	async init() {
		this.techs = new TechMap();

		this.load();

		this.broadcaster = new RateLimiter({
			maxRate: 1,
			action: () => this.broadcast(),
		});

		this.changedTechs = new TechMap();

		this.controller.handle(SyncTechsRequest, this.handleSyncTechsRequest.bind(this));
		this.controller.handle(AdvanceTechEvent, this.handleAdvanceTechEvent.bind(this));
		this.controller.handle(FinishedEvent, this.handleFinishedEvent.bind(this));
	}

	broadcast() {
		if (!this.changedTechs.size) {
			return;
		}

		this.controller.sendTo("allInstances", new UpdateTechsEvent([...this.changedTechs].map(tech => new TechResearch(...tech))));
		this.changedTechs.clear();
	}

	async handleSyncTechsRequest(request: SyncTechsRequest): Promise<TechResearch[]> {
		function baseLevel(name: string): number {
			const match = /-(\d+)$/.exec(name);
			if (!match) {
				return 1;
			}
			return Number.parseInt(match[1], 10);
		}

		for (const { force, name, level: remote } of request.techs) {
			const local = this.techs.get(force, name);
			if (!local) {
				this.techs.set(force, name, remote);
				this.changedTechs.set(force, name, remote);
			} else {
				if (local.absolute >= remote.absolute) {
					continue;
				}

				if (local.full < remote.full || remote.partial >= 1) {
					if (remote.full + Math.floor(remote.partial) > local.full + Math.floor(local.partial)) {
						this.controller.sendTo("allInstances", new UpdateTechsEvent(
							[new TechResearch(force, name, remote.full, 1)]));
					}
					local.full = full;
					local.partial = partial;

					this.techs.set(force, name, { full: full, partial: partial });
					if (partial) {
						this.changedTechs.set(force, name, this.techs.get(force, name));
					} else {
						this.changedTechs.remove(force, name);
					}
				} else if (local.partial && partial && local.partial < partial) {
					local.partial = partial;
					this.changedTechs.set(force, name, local);
				}
				this.techs.set(force, name, local);
			}
		}
		this.broadcaster.activate();

		const technologies = [];
		for (const [force, name, { full: level, partial: progress, researched }] of this.techs) {
			technologies.push(new TechnologySync(force, name, level, progress, researched));
		}

		return technologies;
	}


	async handleAdvanceTechEvent(event: AdvanceTechEvent) {
		const { force, name, level, contribution } = event;
		const tech = this.techs.get(force, name);
		if (!tech) {
			tech = { full: level, partial: 0, researched: false };
			this.techs.set(force, name, tech);

			// Ignore contribution to already researched technologies
		} else if (tech.full > level || tech.full === level && tech.researched) {
			return;
		}

		// Handle contributon to the next level of a researched technology
		if (tech.full === level - 1 && tech.researched) {
			tech.researched = false;
			tech.full = level;
		}

		// Ignore contributions to higher levels
		if (tech.full < level) {
			return;
		}

		const newProgress = tech.partial! + contribution;
		if (newProgress < 1) {
			tech.partial = newProgress;
			this.changedTechs.set(force, name, {} as TechResearch);
			this.broadcaster!.activate();

		} else {
			tech.researched = true;
			tech.partial = null;
			this.changedTechs.remove(force, name);

			this.controller.sendTo("allInstances", new FinishedEvent(force, name, tech.full));
		}
		this.techs.set(force, name, tech);
	}

	async handleFinishedEvent(event: FinishedEvent) {
		const { force, name, level } = event;
		const tech = this.techs.get(force, name);
		if (!tech || tech.full <= level) {
			this.controller.sendTo("allInstances", event);
			this.changedTechs.remove(force, name);
			this.techs.set(force, name, { full: level, partial: null, researched: true });
		}
	}


	async onSaveData() {
		await this.save();
	}

	async onShutdown() {
		this.broadcaster.cancel();
	}
}
