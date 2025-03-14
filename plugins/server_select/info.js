"use strict";

const { plainJson } = require("@clusterio/lib");

const instanceProperties = {
	"id": { type: "integer" },
	"name": { type: "string" },
	"status": { type: "string" },
	"game_port": { type: "integer" },
	"game_version": { type: "string" },
	"public_address": { type: "string" },
};

class GetInstanceRequest {
	static type = "request";
	static src = "controller";
	static dst = "instance";
	static plugin = "server_select";
	static Response = plainJson({
		type: "object",
		additionalProperties: false,
		required: Object.keys(instanceProperties),
		properties: instanceProperties,
	});
}

class GetInstancesRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "server_select";
	static Response = plainJson({
		type: "array",
		items: {
			type: "object",
			additionalProperties: false,
			required: ["id", "name", "status"],
			properties: instanceProperties,
		},
	});
}

class UpdateInstancesEvent {
	static type = "event";
	static src = "controller";
	static dst = "instance";
	static plugin = "server_select";

	constructor(instances, full) {
		this.instances = instances;
		this.full = full;
	}

	static jsonSchema = {
		type: "object",
		required: ["instances", "full"],
		properties: {
			"instances": {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["id"],
					properties: {
						"removed": { type: "boolean" },
						...instanceProperties
					},
				},
			},
			"full": { type: "boolean" },
		},
	};

	static fromJSON(json) {
		return new this(json.instances, json.full);
	}
}

const plugin = {
	name: "server_select",
	title: "Server Select",
	description: "In-game GUI for connecting to other server in the cluster.",
	controllerEntrypoint: "controller",
	instanceEntrypoint: "instance",
	controllerConfigFields: {
		"server_select.show_offline_instances": {
			title: "Show Offline Instances",
			description: "Show instances that are not running in the server list.",
			type: "boolean",
			initialValue: true,
		},
		"server_select.show_unknown_instances": {
			title: "Show Unknown Instances",
			description: "Show instances with an unknown status in the server list.",
			type: "boolean",
			initialValue: true,
		},
	},

	messages: [
		GetInstanceRequest,
		GetInstancesRequest,
		UpdateInstancesEvent,
	],
};

module.exports = {
	plugin,
	GetInstanceRequest,
	GetInstancesRequest,
	UpdateInstancesEvent,
}
