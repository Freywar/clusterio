import { StorageMap } from "./data";
import * as doleNN from "./dole_nn_base";

import * as lib from "@clusterio/lib";
const { Gauge } = lib;


const prometheusNNDoleGauge = new Gauge(
	"clusterio_subspace_storage_nn_dole_gauge",
	"Current demand being supplied by Neural Network ; 1 means all demand covered, " +
	"0.5 means about half of each supply is covered, 0 means no items are given",
	{ labels: ["resource"] }
);
const prometheusDoleFactorGauge = new Gauge(
	"clusterio_subspace_storage_dole_factor_gauge",
	"The current dole division factor for this resource",
	{ labels: ["resource"] }
);

export class NeuralDole {
	getRequestStats(force: string, x: number, y: number, name: string, samples: number): number {
		let sum = 0;
		samples = Math.min(samples, (this.stats[force][x][y][name] || []).length - 1);
		if (samples < 1) {
			return 0.1;
		}
		for (let i = 1; i <= samples; i++) {
			sum += this.stats[force][x][y][name][i].req;
		}
		if (sum === 0) {
			return 0.1;
		}
		return sum / samples;
	}

	storage: StorageMap;
	storageLastTick: StorageMap;
	dole: any = {};
	carry: any = {};
	lastRequest: any = {};
	stats: any = {};
	debt: any = {};
	constructor({ storage }: { storage: StorageMap }) {
		// Set some storage variables for the dole divider
		this.storage = storage;
		this.storageLastTick = new StorageMap(storage.serialize());
	}

	doMagic() {
		for (let [force, x, y, name, count] of this.storage) {
			let magicData = doleNN.tick(
				count,
				this.dole[name],
				this.storageLastTick.get(force, x, y, name),
				this.getRequestStats(force, x, y, name, 5)
			);
			this.stats[force][x][y][name] = this.stats[force][x][y][name] || [];
			this.stats[force][x][y][name].unshift({ req: 0, given: 0 }); // stats[name][0] is the one we currently collect
			if (this.stats[force][x][y][name].length > 10) {
				this.stats[force][x][y][name].pop(); // remove if too many samples in stats
			}

			this.dole[name] = magicData[0];
			// DONE handle magicData[1] for graphing for our users
			prometheusNNDoleGauge.labels(name).set(magicData[1] || 0);
		}
		this.storageLastTick = new StorageMap(this.storage);
	}

	divider(object: { force: string, cx: number, cy: number, name: string, count: number, instanceId: number, instanceName: string }): number {
		let magicData = doleNN.dose(
			object.count, // numReq
			this.storage.get(object.force, object.cx, object.cy, object.name),
			this.storageLastTick.get(object.force, object.cx, object.cy, object.name) || 0,
			this.dole[object.name],
			this.carry[`${object.name} ${object.instanceId}`] || 0,
			this.lastRequest[`${object.name}_${object.instanceId}_${object.instanceName}`] || 0,
			this.getRequestStats(object.force, object.cx, object.cy, object.name, 5),
			this.debt[`${object.name} ${object.instanceId}`] || 0
		);
		if ((this.stats[object.name] || []).length > 0) {
			this.stats[object.name][0].req += Number(object.count);
			this.stats[object.name][0].given += Number(magicData[0]);
		}
		this.lastRequest[`${object.name}_${object.instanceId}_${object.instanceName}`] = object.count;
		// 0. Number of items to give in that dose
		// 1. New dole for item X
		// 2. New carry for item X instance Y
		this.dole[object.name] = magicData[1];
		this.carry[`${object.name} ${object.instanceId}`] = magicData[2];
		this.debt[`${object.name} ${object.instanceId}`] = magicData[3];

		// Remove item from DB and send it
		this.storage.update(object.force, object.cx, object.cy, object.name, c => c - magicData[0]);

		return magicData[0];
	}
}

// If the server regularly can't fulfill requests, this number grows until
// it can. Then it slowly shrinks back down.
let _doleDivisionFactor: { [key: string]: number } = {};
export function doleDivider(
	{
		object,
		items,
		logItemTransfers,
		logger,
	}: {
		object: { force: string, cx: number, cy: number, name: string, count: number, instanceId: number, instanceName: string },
		items: StorageMap,
		logItemTransfers: boolean,
		logger: lib.Logger,
	},
) {
	let itemCount = items.get(object.force, object.cx, object.cy, object.name) || 0;
	// lower rates will equal more dramatic swings
	const doleDivisionRetardation = 10;
	// a higher cap will divide the store more ways, but will take longer to
	// recover as supplies increase
	const maxDoleDivision = 250;

	const originalCount = Number(object.count) || 0;
	object.count /= ((_doleDivisionFactor[object.name] || 0) + doleDivisionRetardation) / doleDivisionRetardation;
	object.count = Math.round(object.count);
	if (logItemTransfers) {
		logger.verbose(
			`Serving ${object.count}/${originalCount} ${object.name} from ${itemCount} ${object.name} ` +
			`with dole division factor ${(_doleDivisionFactor[object.name] || 0)} ` +
			`(real=${((_doleDivisionFactor[object.name] || 0) + doleDivisionRetardation) / doleDivisionRetardation}), ` +
			`item is ${itemCount > object.count ? "stocked" : "short"}.`
		);
	}

	// Update existing items if item name already exists
	if (itemCount > object.count) {
		// If successful, increase dole
		_doleDivisionFactor[object.name] = Math.max(_doleDivisionFactor[object.name] || 1, 1) - 1;
		items.update(object.force, object.cx, object.cy, object.name, c => c - object.count);

		prometheusDoleFactorGauge.labels(object.name).set(_doleDivisionFactor[object.name] || 0);
		return object.count;
	}

	// if we didn't have enough, attempt giving out a smaller amount next time
	_doleDivisionFactor[object.name] = Math.min(
		maxDoleDivision, Math.max(_doleDivisionFactor[object.name] || 1, 1) * 2
	);
	prometheusDoleFactorGauge.labels(object.name).set(_doleDivisionFactor[object.name] || 0);
	return 0;
	// console.log(`failure out of ${object.name}/${object.count} from ${object.instanceID} (${object.instanceName})`);
}
