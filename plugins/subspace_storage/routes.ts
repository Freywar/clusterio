import type { Application, Request, Response } from "express";
import { ItemStorage } from "./data";

export function addAPIRoutes(app: Application, storage: ItemStorage) {

	/**
	 * GET endpoint to read the controllers current storage.
	 *
	 * @memberof clusterioController
	 * @instance
	 * @alias api/storage
	 * @returns {object[]} JSON [{force:"player", cx:1, cy:2, item:"iron-plate", count:100}]
	 */
	app.get("/api/storage", (req: Request, res: Response) => {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		res.type("json");
		const result = [];
		for (const [force, cx, cy, item, count] of storage) {
			result.push({ force, cx, cy, item, count });
		}
		res.send(JSON.stringify(result));
	});
}
