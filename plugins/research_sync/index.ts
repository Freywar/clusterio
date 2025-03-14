import * as lib from "@clusterio/lib";
import * as messages from "./messages";

declare module "@clusterio/lib" {
	export interface ControllerConfigFields {
		"research_sync.log_transfers": boolean;
	}
	export interface InstanceConfigFields {
		"research_sync.log_transfers": boolean;
	}
}

lib.definePermission({
	name: "research_sync.technologies.view",
	title: "View Technology Levels",
	description: "View the current levels of research.",
	grantByDefault: true,
});

export const plugin: lib.PluginDeclaration = {
	name: "research_sync",
	title: "Research Sync",
	description: "Synchronises technology research progress between instances.",
	instanceEntrypoint: "dist/node/instance",
	instanceConfigFields: {
		"research_sync.log_transfers": {
			title: "Log Transfers",
			description: "Spam host console with research transfers done.",
			type: "boolean",
			initialValue: false,
		},
	},

	controllerEntrypoint: "dist/node/controller",
	controllerConfigFields: {
		"research_sync.log_transfers": {
			title: "Log Transfers",
			description: "Spam controller console with research transfers done.",
			type: "boolean",
			initialValue: false,
		},
	},

	messages: [
		messages.ReadTechsRequest,
		messages.WriteTechsEvent,
		messages.SyncTechsRequest,
		messages.ProgressTechsEvent,
		messages.UpdateDatabaseSubscriptionRequest,
	],
	webEntrypoint: "./web",
	routes: ["/research"],
};
