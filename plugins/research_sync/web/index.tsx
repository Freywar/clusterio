import React, { useContext, useEffect, useState } from "react";
import { Input, Table, Typography } from "antd";

import * as lib from "@clusterio/lib";
import {
	BaseWebPlugin, PageLayout, PageHeader, Control, ControlContext,
	notifyErrorHandler, useItemMetadata, useLocale,
} from "@clusterio/web_ui";
import { GetStorageRequest, Item, SetStorageSubscriptionRequest, UpdateStorageEvent } from "../messages";

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
		return () => {
			plugin.offUpdate(update);
		};
	}, []);
	return storage;
}

function StoragePage() {
	let control = useContext(ControlContext);
	let locale = useLocale();
	let itemMetadata = useItemMetadata();
	let storage = useStorage(control);
	type ItemFilter = ([name, count]: [string, number]) => boolean;
	let [filter, setFilter] = useState<null | ItemFilter>(null);

	function getLocaleName(itemName: string) {
		let localeName = itemName;
		let meta = itemMetadata.get(itemName);
		if (meta && meta.localised_name) {
			// TODO: implement the locale to name conversion.
			localeName = locale.get(meta.localised_name[0])!;
		} else {
			for (let section of ["item-name", "entity-name", "fluid-name", "equipment-name"]) {
				let name = locale.get(`${section}.${itemName}`);
				if (name) {
					localeName = name;
					break;
				}
			}
		}

		return localeName;
	}

	let numberFormat = new Intl.NumberFormat("en-US");

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
					search = search.replace(/(^| )(\w)/g, "$1\\b$2");
					search = search.replace(/ +/g, ".*");
					let filterExpr = new RegExp(search, "i");
					setFilter(() => ((item: [string, number]) => {
						let name = getLocaleName(item[0]);
						return filterExpr.test(name) || filterExpr.test(item[0]);
					}));
				}}
			/>
		</Paragraph>
		<Table
			columns={[
				{
					title: "Force",
					key: "force",
					sorter: (a, b) => {
						let aName = getLocaleName(a[0].split(':')[0] ?? a[0]);
						let bName = getLocaleName(b[0].split(':')[0] ?? b[0]);
						if (aName < bName) { return -1; }
						if (aName > bName) { return 1; }
						return 0;
					},
					render: (_, item) => {
						return <>{item[0].split(':')[0] ?? "player"}</>;
					},
				},
				{
					title: "Resource",
					key: "resource",
					sorter: (a, b) => {
						let aName = getLocaleName(a[0].split(':')[1] ?? a[0]);
						let bName = getLocaleName(b[0].split(':')[1] ?? b[0]);
						if (aName < bName) { return -1; }
						if (aName > bName) { return 1; }
						return 0;
					},
					render: (_, item) => {
						let localeName = getLocaleName(item[0].split(':')[0] ?? item[0]);
						let hasMeta = itemMetadata.get(item[0].split(':')[0] ?? item[0]);

						return <>
							<span className={`factorio-icon item-${hasMeta ? item[0] : "unknown-item"}`} />
							{localeName}
						</>;
					},
				},
				{
					title: "Quantity",
					key: "quantity",
					align: "right",
					defaultSortOrder: "descend",
					sorter: (a, b) => a[1] - b[1],
					render: (_, item) => numberFormat.format(item[1]),
				},
			]}
			dataSource={filter ? storage.filter(filter) : storage}
			rowKey={item => item[0]}
			pagination={false}
		/>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	storage = new Map<string, number>();
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
		if (this.callbacks.length) {
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

	updateStorage(items: Item[]) {
		for (let item of items) {
			this.storage.set(item.name, item.count);
		}
		for (let callback of this.callbacks) {
			callback();
		}
	}

	updateSubscription() {
		if (!this.control.connector.connected) {
			return;
		}

		this.control.send(
			new SetStorageSubscriptionRequest(Boolean(this.callbacks.length))
		).catch(notifyErrorHandler("Error subscribing to storage"));

		if (this.callbacks.length) {
			this.control!.send(new GetStorageRequest()).then(
				items => {
					this.updateStorage(items);
				}
			).catch(notifyErrorHandler("Error  updating storage"));
		} else {
			this.storage.clear();
		}
	}
}
