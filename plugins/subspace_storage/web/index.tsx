import { Input, Table, Typography } from "antd";
import { useContext, useEffect, useState } from "react";

import {
	BaseWebPlugin,
	Control, ControlContext,
	notifyErrorHandler,
	PageHeader,
	PageLayout,
	useItemMetadata,
	useLocale,
} from "@clusterio/web_ui";
import { ItemStorage } from "../data";
import { ItemPackage, ReadItemsRequest, UpdateStorageSubscriptionRequest, WriteItemsEvent } from "../messages";

import "./style.css";

const { Paragraph } = Typography;

function useStorage(control: Control) {
	const plugin = control.plugins.get("subspace_storage") as WebPlugin;
	const [storage, setStorage] = useState([...plugin.storage]);

	useEffect(() => {
		const update = () => setStorage([...plugin.storage]);

		plugin.onUpdate(update);

		return () => plugin.offUpdate(update);
	}, []);
	return storage;
}

function StoragePage() {
	const control = useContext(ControlContext);
	const locale = useLocale();
	const itemMetadata = useItemMetadata();
	const storage = useStorage(control);
	type ItemFilter = ([force, endpoint, item, count]: [string, number, number, string, number]) => boolean;
	const [filter, setFilter] = useState<null | ItemFilter>(null);

	function getLocaleName(item: string) {
		const meta = itemMetadata.get(item);
		if (meta?.localised_name) {
			// TODO: implement the locale to name conversion.
			return locale.get(meta.localised_name[0])!;
		}

		for (const section of ["item-name", "entity-name", "fluid-name", "equipment-name"]) {
			const name = locale.get(`${section}.${item}`);
			if (name) {
				return name;
			}
		}

		return item;
	}

	const numberFormat = new Intl.NumberFormat("en-US");

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
					const re = new RegExp(search.replace(/(^| )(\w)/g, "$1\\b$2").replace(/ +/g, ".*"), "i");
					setFilter(() => ([f, , , i]: [string, number, number, string, number]) => re.test(f)
						|| re.test(i) || re.test(getLocaleName(i)));
				}}
			/>
		</Paragraph>
		<Table
			columns={[
				{
					title: "Force",
					key: "force",
					sorter: ([l], [r]) => "".localeCompare.call(l, r),
					render: (_, [force]) => <>{force}</>,
				},
				{
					title: "Endpoint",
					key: "endpoint",
					sorter: ([, lx, ly], [, rx, ry]) => (rx - lx) || (ry - ly),
					render: (_, [, cx, cy]) => <>{cx}, {cy}</>,
				},
				{
					title: "Resource",
					key: "item",
					sorter: ([, , , li], [, , , ri]) => "".localeCompare.call(getLocaleName(li), getLocaleName(ri)),
					render: (_, [, , , item]) => <>
						<span className={`factorio-icon item-${itemMetadata.get(item) ? item : "unknown-item"}`} />
						{getLocaleName(item)}
					</>,
				},
				{
					title: "Amount",
					key: "count",
					align: "right",
					defaultSortOrder: "descend",
					sorter: ([, , , , l], [, , , , r]) => l - r,
					render: (_, [, , , , count]) => numberFormat.format(count),
				},
			]}
			dataSource={filter ? storage.filter(filter) : storage}
			rowKey={([force, cx, cy, item]) => `${force}/${cx}/${cy}/${item}`}
			pagination={false}
		/>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	storage: ItemStorage = new ItemStorage();
	callbacks: (() => void)[] = [];

	private rewrite(items: ItemPackage[]) {
		for (const { force, cx, cy, item, count } of items) {
			this.storage.set(force, cx, cy, item, count);
		}
		for (const callback of this.callbacks) {
			callback();
		}
	}

	private async handleWriteItemsEvent(event: WriteItemsEvent) {
		this.rewrite(event.items);
	}

	private updateSubscription() {
		if (!this.control.connector.connected) {
			return;
		}

		this.control
			.send(new UpdateStorageSubscriptionRequest(Boolean(this.callbacks.length)))
			.catch(notifyErrorHandler("Error subscribing to storage"));

		if (this.callbacks.length) {
			this.control!.send(new ReadItemsRequest())
				.then(items => this.rewrite(items))
				.catch(notifyErrorHandler("Error updating storage"));
		} else {
			this.storage.clear();
		}
	}

	async init() {
		this.pages = [
			{
				path: "/storage",
				sidebarName: "Storage",
				permission: "subspace_storage.storage.view",
				content: <StoragePage />,
			},
		];
		this.control.handle(WriteItemsEvent, this.handleWriteItemsEvent.bind(this));
	}

	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
		if (event === "connect") {
			this.updateSubscription();
		}
	}

	onUpdate(callback: () => void) {
		this.callbacks.push(callback);
		if (this.callbacks.length === 1) {
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
}
