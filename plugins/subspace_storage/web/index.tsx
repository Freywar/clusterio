import { Input, Table, Typography } from "antd";
import { useContext, useEffect, useState } from "react";

import {
	BaseWebPlugin, Control, ControlContext, notifyErrorHandler, PageHeader, PageLayout, useItemMetadata, useLocale,
} from "@clusterio/web_ui";
import { Count, GetStorageRequest, ManageSubscriptionRequest, UpdateStorageEvent } from "../messages";

import { ChunkCoordinate, ChunkMap, ForceName, ItemName } from "../data";
import "./style.css";

const { Paragraph } = Typography;

type Item = [ForceName, ChunkCoordinate, ChunkCoordinate, ItemName, number];

function useStorage(control: Control) {
	const plugin = control.plugins.get("subspace_storage") as WebPlugin;
	const [storage, setStorage] = useState([...plugin.storage]);

	useEffect(() => {
		function update() {
			setStorage([...plugin.storage]);
		}

		plugin.onUpdate(update);
		return () => plugin.offUpdate(update);
	}, []);

	return storage;
}

type ItemFilter = ([force, x, y, name, count]: Item) => boolean;

function StoragePage() {
	const control = useContext(ControlContext);
	const locale = useLocale();
	const itemMetadata = useItemMetadata();
	const storage = useStorage(control);
	const [filter, setFilter] = useState<null | ItemFilter>(null);

	function getLocaleName(name: ItemName) {
		const meta = itemMetadata.get(name);
		if (meta?.localised_name) {
			// TODO: implement the locale to name conversion.
			return locale.get(meta.localised_name[0])!;
		}
		for (const section of ["item-name", "entity-name", "fluid-name", "equipment-name"]) {
			const sectionedName = locale.get(`${section}.${name}`);
			if (sectionedName) {
				return sectionedName;
			}
		}
		return name;
	}

	const NumberFormat = new Intl.NumberFormat("en-US");

	return <PageLayout nav={[{ name: "Storage" }]}>
		<PageHeader title="Storage" />
		<Paragraph>
			<Input
				placeholder="Search"
				onChange={(event) => {
					const search = event.target.value.trim();
					if (!search) {
						setFilter(null);
						return;
					}
					const filterExpr = new RegExp(search.replace(/(^| )(\w)/g, "$1\\b$2").replace(/ +/g, ".*"), "i");
					setFilter(() => (([, , , name]: Item) => filterExpr.test(name)
						|| filterExpr.test(getLocaleName(name))));
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
					render: (_, [force]) => <>{force ?? "player"}</>,
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
					render: (_, [, x, y]) => <>{x},{y}</>,
				},
				{
					title: "Resource",
					key: "resource",
					sorter: ([, , , an], [, , , bn]) => {
						const aln = getLocaleName(an);
						const bln = getLocaleName(bn);
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
					sorter: ([, , , , ac], [, , , , bc]) => ac - bc,
					render: (_, [, , , , count]) => NumberFormat.format(count),
				},
			]}
			dataSource={filter ? storage.filter(filter) : storage}
			rowKey={([f, x, y, n]) => `${f}/${x}/${y}/${n}`}
			pagination={false}
		/>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	storage: ChunkMap<ItemName> = new ChunkMap();
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
		const index = this.callbacks.lastIndexOf(callback);
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
			.send(new ManageSubscriptionRequest(Boolean(this.callbacks.length)))
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

	updateStorage(items: Count<ItemName>[]) {
		for (const { force, cx, cy, name, count } of items) {
			this.storage.set(force, cx, cy, name, count);
		}
		for (const callback of this.callbacks) {
			callback();
		}
	}
}
