"use strict";
const { BaseControllerPlugin } = require("@clusterio/controller");

const {
	GetInstanceRequest,
	GetInstancesRequest,
	UpdateInstancesEvent,
} = require("./info");

class ControllerPlugin extends BaseControllerPlugin {
	async init() {
		this.instances = new Map();
		if (this.controller.config.get("server_select.show_unknown_instances")) {
			for (let [instanceId, instance] of this.controller.instances) {
				if (instance.status === "unknown") {
					this.instances.set(instanceId, {
						"id": instanceId,
						"name": instance.config.get("instance.name"),
						"status": "unknown",
					});
				}
			}
		}
		this.controller.handle(GetInstancesRequest, () => [...this.instances.values()]);
	}

	async onControllerConfigFieldChanged(field, curr, prev) {
		if (
			field === "server_select.show_unknown_instances"
			|| field === "server_select.show_offline_instances"
		) {
			await this.updateInstances()
		}
	}

	shouldShowInstance(instance) {
		if (["unassigned", "deleted"].includes(instance.status)) {
			return false;
		}
		if (instance.status === "unknown") {
			return this.controller.config.get("server_select.show_unknown_instances");
		}
		if (instance.status === "running") {
			return true;
		}
		return this.controller.config.get("server_select.show_offline_instances");
	}

	async updateInstanceData(instance) {
		let instanceId = instance.config.get("instance.id");
		if (instance.status === "running") {
			let hostConnection = this.controller.wsServer.hostConnections.get(
				instance.config.get("instance.assigned_host")
			);
			if (!hostConnection) { // Should be impossible
				return;
			}

			// This request is almost obsolete, it could be removed once
			// game version becomes known to the controller.
			let instanceData = await this.controller.sendTo({ instanceId }, new GetInstanceRequest());

			let currentData = {
				id: instance.id,
				name: instance.config.get("instance.name"),
				status: instance.status,
				game_port: instance.gamePort,
				public_address: this.controller.hosts.get(instance.config.get("instance.assigned_host"))?.publicAddress,
				game_version: instanceData.game_version,
			};
			this.instances.set(instanceId, currentData);
		}

		let instanceData = this.instances.get(instanceId);
		if (!instanceData) {
			instanceData = {
				"id": instanceId,
				"name": instance.config.get("instance.name"),
			};
			this.instances.set(instanceId, instanceData);
		}
		instanceData["status"] = instance.status;
		return instanceData;
	}

	async onInstanceStatusChanged(instance, prev) {
		let instanceId = instance.config.get("instance.id");
		if (this.shouldShowInstance(instance)) {
			let instanceData = await this.updateInstanceData(instance);
			this.controller.sendTo("allInstances",
				new UpdateInstancesEvent([instanceData], false),
			);

		} else {
			this.instances.delete(instanceId);
			this.controller.sendTo("allInstances",
				new UpdateInstancesEvent(
					[{ id: instance.config.get("instance.id"), removed: true }],
					false,
				),
			);
		}
	}

	async onInstanceConfigFieldChanged(instance, field, currentValue, previousValue) {
		if (field === "instance.name") {
			if (this.shouldShowInstance(instance)) {
				let instanceData = await this.updateInstanceData(instance);
				this.controller.sendTo("allInstances",
					new UpdateInstancesEvent([instanceData], false),
				);
			}
		}
	}

	async updateInstances() {
		for (let [instanceId, instance] of this.controller.instances) {
			if (this.shouldShowInstance(instance)) {
				if (!this.instances.has(instanceId)) {
					await this.updateInstanceData(instance);
				}
			} else {
				this.instances.delete(instanceId);
			}
		}

		this.controller.sendTo("allInstances",
			new UpdateInstancesEvent([...this.instances.values()], true)
		);
	}
}

module.exports = {
	ControllerPlugin,
};
