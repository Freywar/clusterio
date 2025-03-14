"use strict";
const lib = require("@clusterio/lib");
const { BaseInstancePlugin } = require("@clusterio/host");

const {
	GetInstanceRequest,
	GetInstancesRequest,
	UpdateInstancesEvent,
} = require("./info");


class InstancePlugin extends BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("server_select plugin requires save patching.");
		}

		this.pendingCommands = [];
		this.currentlySending = false;
		this.instance.handle(GetInstanceRequest, this.handleGetInstanceRequest.bind(this));
		this.instance.handle(UpdateInstancesEvent, this.handleUpdateInstancesEvent.bind(this));
	}

	async sendPendingRcon() {
		this.currentlySending = true;
		while (this.pendingCommands.length) {
			let task = this.pendingCommands.shift();
			try {
				let result = await this.sendRcon(task.command, task.expectEmpty);
				task.resolve(result);
			} catch (err) {
				task.reject(err);
			}
		}
		this.currentlySending = false;
	}

	async serialRcon(command, expectEmpty = false) {
		let promise = new Promise((resolve, reject) => {
			this.pendingCommands.push({resolve, reject, command, expectEmpty});
		});
		if (!this.currentlySending) {
			this.sendPendingRcon();
		}
		return await promise;
	}

	async handleGetInstanceRequest() {
		return {
			id: this.instance.config.get("instance.id"),
			name: this.instance.name,
			status: this.instance.status,
			game_port: this.instance.server.gamePort,
			game_version: this.instance.server.version,
			public_address: this.host.config.get("host.public_address"),
		};
	}

	async updateList() {
		let instances = await this.instance.sendTo("controller", new GetInstancesRequest());
		let instancesJson = lib.escapeString(JSON.stringify(instances));
		await this.serialRcon(`/sc server_select.update_instances("${instancesJson}", true)`, true);
	}

	onControllerConnectionEvent(event) {
		if (event === "connect" && this.instance.status === "running") {
			this.updateList().catch(err => this.logger.error(`Unexpected error updating server list:\n${err.stack}`));
		}
	}

	async onStart() {
		await this.updateList();
	}

	async handleUpdateInstancesEvent(event) {
		if (this.instance.status !== "running") {
			return;
		}
		let instancesJson = lib.escapeString(JSON.stringify(event.instances));
		await this.serialRcon(`/sc server_select.update_instances("${instancesJson}", ${event.full})`, true);
	}
}

module.exports = {
	InstancePlugin,
};
