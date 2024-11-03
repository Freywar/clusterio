import fs from "fs-extra";
import path from "path";
import { BaseControllerPlugin } from "@clusterio/controller";

import * as lib from "@clusterio/lib";
const { RateLimiter } = lib;

import {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	TechnologySync,
	SyncTechnologiesRequest,
	TechnologyProgress,
} from "./messages";
import { Technology, TechnologyMap } from "./data";

async function loadTechnologies(
	controllerConfig: lib.ControllerConfig,
	logger: lib.Logger
): Promise<TechnologyMap> {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "technologies.json");
	logger.verbose(`Loading ${filePath}`);
	try {
		return new TechnologyMap(JSON.parse(await fs.readFile(filePath, "utf8")));
	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new technologies database");
			return new TechnologyMap();
		}
		throw err;
	}
}

async function saveTechnologies(
	controllerConfig: lib.ControllerConfig,
	technologies: TechnologyMap,
	logger: lib.Logger
) {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "technologies.json");
	logger.verbose(`Writing ${filePath}`);
	await lib.safeOutputFile(filePath, JSON.stringify(technologies.serialize(), null, "\t"));
}

export class ControllerPlugin extends BaseControllerPlugin {
	technologies!: TechnologyMap;
	changedTechnologies!: TechnologyMap;
	broadcastRateLimiter!: lib.RateLimiter;
	

	async init() {
		this.technologies = await loadTechnologies(this.controller.config, this.logger);
		this.broadcastRateLimiter = new RateLimiter({
			maxRate: 1,
			action: () => this.broadcastProgress(),
		});

		this.changedTechnologies = new TechnologyMap();

		this.controller.handle(ContributionEvent, this.handleContributionEvent.bind(this));
		this.controller.handle(FinishedEvent, this.handleFinishedEvent.bind(this));
		this.controller.handle(SyncTechnologiesRequest, this.handleSyncTechnologiesRequest.bind(this));
	}

	async onSaveData() {
		if (this.technologies.dirty) {
			await saveTechnologies(this.controller.config, this.technologies, this.logger);
		}
	}

	async onShutdown() {
		this.broadcastRateLimiter.cancel();
	}

	broadcastProgress() {
		let techs = [];
		for (let [force, name, dirty] of this.changedTechnologies) {
			if (dirty) {
				let tech = this.technologies.get(force, name);
				if (tech?.progress) {
					techs.push(new TechnologyProgress(force, name, tech.level, tech.progress));
				}
			}
		}
		this.changedTechnologies.clear();

		if (techs.length) {
			this.controller.sendTo("allInstances", new ProgressEvent(techs));
		}
	}

	async handleContributionEvent(event: ContributionEvent) {
		let { force, name, level, contribution } = event;
		let tech = this.technologies.get(force, name);
		if (!tech) {
			tech = { level, progress: 0, researched: false };
			this.technologies.set(force, name, tech);

			// Ignore contribution to already researched technologies
		} else if (tech.level > level || tech.level === level && tech.researched) {
			return;
		}

		// Handle contributon to the next level of a researched technology
		if (tech.level === level - 1 && tech.researched) {
			tech.researched = false;
			tech.level = level;
		}

		// Ignore contributions to higher levels
		if (tech.level < level) {
			return;
		}

		let newProgress = tech.progress! + contribution;
		if (newProgress < 1) {
			tech.progress = newProgress;
			this.changedTechnologies.set(force, name, {} as Technology);
			this.broadcastRateLimiter!.activate();

		} else {
			tech.researched = true;
			tech.progress = null;
			this.changedTechnologies.remove(force, name);

			this.controller.sendTo("allInstances", new FinishedEvent(force, name, tech.level));
		}
		this.technologies.set(force, name, tech);
	}

	async handleFinishedEvent(event: FinishedEvent) {
		let { force, name, level } = event;
		let tech = this.technologies.get(force, name);
		if (!tech || tech.level <= level) {
			this.controller.sendTo("allInstances", event);
			this.changedTechnologies.remove(force, name);
			this.technologies.set(force, name, { level, progress: null, researched: true });
		}
	}

	async handleSyncTechnologiesRequest(request: SyncTechnologiesRequest): Promise<TechnologySync[]> {
		function baseLevel(name: string): number {
			let match = /-(\d+)$/.exec(name);
			if (!match) {
				return 1;
			}
			return Number.parseInt(match[1], 10);
		}

		for (let instanceTech of request.technologies) {
			let { force, name, level, progress, researched } = instanceTech;
			let tech = this.technologies.get(force, name);
			if (!tech) {
				this.technologies.set(force, name, { level, progress, researched });
				if (progress) {
					this.changedTechnologies.set(force, name, {} as Technology);
				} else if (researched || baseLevel(name) !== level) {
					this.controller.sendTo("allInstances", new FinishedEvent(force, name, level));
				}

			} else {
				if (tech.level > level || tech.level === level && tech.researched) {
					continue;
				}

				if (tech.level < level || researched) {
					// Send update if the unlocked level is greater
					if (level - Number(!researched) > tech.level - Number(!tech.researched)) {
						this.controller.sendTo("allInstances", new FinishedEvent(force, name, level - Number(!researched)));
					}
					tech.level = level;
					tech.progress = progress;
					tech.researched = researched;

					if (progress) {
						this.changedTechnologies.set(force, name, tech);
					} else {
						this.changedTechnologies.remove(force, name);
					}
				} else if (tech.progress && progress && tech.progress < progress) {
					tech.progress = progress;
					this.changedTechnologies.set(force, name, tech);
				}
				this.technologies.set(force, name, tech);
			}
		}
		this.broadcastRateLimiter.activate();

		let technologies = [];
		for (let [force, name, { level, progress, researched }] of this.technologies) {
			technologies.push(new TechnologySync(force, name, level, progress, researched));
		}

		return technologies;
	}
}
