import React, { useContext, useEffect, useState } from "react";
import { Input, Table, Typography } from "antd";

import {
	BaseWebPlugin, PageLayout, PageHeader, Control, ControlContext,
	notifyErrorHandler, useItemMetadata, useLocale,
} from "@clusterio/web_ui";
import { StorageMap } from "../data";
import { GetStorageRequest, Item, SubscribeOnStorageRequest, UpdateStorageEvent } from "../messages";

import "./style.css";

const { Paragraph } = Typography;

function useStorage(control: Control) {
	let plugin = control.plugins.get("subspace_storage") as WebPlugin;
	let [storage, setStorage] = useState([...plugin.storage]);

	useEffect(() => {
		function update() {
			setStorage([...plugin.storage]);
		}

		plugin.onUpdate(update);
		return () => plugin.offUpdate(update);
	}, []);

	return storage;
}

type ItemFilter = ([force, x, y, name, count]: [string, number, number, string, number]) => boolean;

function StoragePage() {
	let control = useContext(ControlContext);
	let locale = useLocale();
	let itemMetadata = useItemMetadata();
	let storage = useStorage(control);
	let [filter, setFilter] = useState<null | ItemFilter>(null);

	function getLocaleName(name: string) {
		let meta = itemMetadata.get(name);
		if (meta?.localised_name) {
			// TODO: implement the locale to name conversion.
			return locale.get(meta.localised_name[0])!;
		} else {
			for (let section of ["item-name", "entity-name", "fluid-name", "equipment-name"]) {
				let sectionedName = locale.get(`${section}.${name}`);
				if (sectionedName) {
					return sectionedName;
				}
			}
		}

		return name;
	}

	let NumberFormat = new Intl.NumberFormat("en-US");

	return <PageLayout nav={[{ name: "Storage" }]}>
		<PageHeader title="Storage" />
		<Paragraph>
			<Input
				placeholder="Search"
				onChange={(event) => {
					let search = event.target.value.trim();
					if (!search) {
						setFilter(null);
						return;
					}
					let filterExpr = new RegExp(search.replace(/(^| )(\w)/g, "$1\\b$2").replace(/ +/g, ".*"), "i");
					setFilter(() => (([, , , name, count]: [string, number, number, string, number]) =>
						filterExpr.test(name) || filterExpr.test(getLocaleName(name))));
				}}
			/>
		</Paragraph>
		<Table
			columns={[
				{
					title: "Force",
					key: "force",
					sorter: ([af], [bf]) => {
						if (af < bf) { return -1; }
						if (af > bf) { return 1; }
						return 0;
					},
					render: (_, [force]) => <>{force ?? "player"}</>
				},
				{
					title: "Chunk",
					key: "chunk",
					sorter: ([, ax, ay], [, bx, by]) => {
						if (ax < bx) { return -1; }
						if (ax > bx) { return 1; }
						if (ay < by) { return -1; }
						if (ay > by) { return 1; }
						return 0;
					},
					render: (_, [, x, y]) => <>{x},{y}</>
				},
				{
					title: "Resource",
					key: "resource",
					sorter: ([, , , an], [, , , bn]) => {
						let aln = getLocaleName(an);
						let bln = getLocaleName(bn);
						if (aln < bln) { return -1; }
						if (aln > bln) { return 1; }
						return 0;
					},
					render: (_, [, , , name]) => <>
						<span className={`factorio-icon item-${itemMetadata.get(name) ? name : "unknown-item"}`} />
						{getLocaleName(name)}
					</>,
				},
				{
					title: "Quantity",
					key: "quantity",
					align: "right",
					defaultSortOrder: "descend",
					sorter: ([,,,,ac], [,,,,bc]) => ac - bc,
					render: (_, [,,,,count]) => NumberFormat.format(count),
				},
			]}
			dataSource={filter ? storage.filter(filter) : storage}
			rowKey={([f, x, y, n]) => `${f}/${x}/${y}/${n}`}
			pagination={false}
		/>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	storage = new StorageMap();
	callbacks: (() => void)[] = [];

	async init() {
		this.pages = [
			{
				path: "/storage",
				sidebarName: "Storage",
				permission: "subspace_storage.storage.view",
				content: <StoragePage />,
			},
		];
		this.control.handle(UpdateStorageEvent, this.handleUpdateStorageEvent.bind(this));
	}

	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
		if (event === "connect") {
			this.updateSubscription();
		}
	}

	async handleUpdateStorageEvent(event: UpdateStorageEvent) {
		this.updateStorage(event.items);
	}

	onUpdate(callback: () => void) {
		this.callbacks.push(callback);
		if (!this.callbacks.length) {
			this.updateSubscription();
		}
	}

	offUpdate(callback: () => void) {
		let index = this.callbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}

		this.callbacks.splice(index, 1);
		if (!this.callbacks.length) {
			this.updateSubscription();
		}
	}

	updateSubscription() {
		if (!this.control.connector.connected) {
			return;
		}

		this.control
			.send(new SubscribeOnStorageRequest(!!this.callbacks.length))
			.catch(notifyErrorHandler("Error subscribing to storage"));

		if (this.callbacks.length) {
			this.control!
				.send(new GetStorageRequest())
				.then(items => this.updateStorage(items))
				.catch(notifyErrorHandler("Error updating storage"));
		} else {
			this.storage.clear();
		}
	}

	updateStorage(items: Item[]) {
		for (let { force, x, y, name, count } of items) {
			this.storage.set(force, x, y, name, count);
		}
		for (let callback of this.callbacks) {
			callback();
		}
	}
}
