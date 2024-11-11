import type { Application, Request, Response } from "express";
import { ChunkMap, ItemName } from "./data";

export function addApiRoutes(app: Application, storage: ChunkMap<ItemName>) {

	/**
	 * GET endpoint to read the controllers current storage.
	 *
	 * @memberof clusterioController
	 * @instance
	 * @alias api/storage
	 * @returns {object[]} JSON [{name:"iron-plate", count:100},{name:"copper-plate",count:5}]
	 */
	app.get("/api/storage", (req: Request, res: Response) => {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		// Check it and send it
		let result = [];
		for (let [force, cx, cy, name, count] of storage.entries()) {
			result.push({ force, cx, cy, name, count });
		}
		res.type("json");
		res.send(JSON.stringify(result));
	});
}
