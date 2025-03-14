import { Input, Progress, Table, Typography } from "antd";
import { useContext, useEffect, useState } from "react";

import {
	BaseWebPlugin,
	Control, ControlContext,
	notifyErrorHandler,
	PageHeader,
	PageLayout,
	useLocale,
} from "@clusterio/web_ui";
import { TechDatabase } from "../data";
import { ReadTechsRequest, Tech, UpdateDatabaseSubscriptionRequest, WriteTechsEvent } from "../messages";

import "./style.css";

const { Paragraph } = Typography;

function useDatabase(control: Control) {
	const plugin = control.plugins.get("research_sync") as WebPlugin;
	const [database, setDatabase] = useState([...plugin.database]);

	useEffect(() => {
		const update = () => setDatabase([...plugin.database]);

		plugin.onUpdate(update);

		return () => plugin.offUpdate(update);
	}, []);
	return database;
}

function TechsPage() {
	const control = useContext(ControlContext);
	const locale = useLocale();
	const database = useDatabase(control);
	type TechFilter = ([force, tech, level]: [string, string, number]) => boolean;
	const [filter, setFilter] = useState<null | TechFilter>(null);

	function getLocaleName(tech: string) {
		return locale.get(`technology-name.${tech}`) || tech;
	}

	const numberFormat = new Intl.NumberFormat("en-US");

	return <PageLayout nav={[{ name: "Research" }]}>
		<PageHeader title="Technologies" />
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
					setFilter(() => ([f, t]: [string, string, number]) => re.test(f)
						|| re.test(t) || re.test(getLocaleName(t)));
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
					title: "Technology",
					key: "item",
					sorter: ([, lt], [, rt]) => "".localeCompare.call(getLocaleName(lt), getLocaleName(rt)),
					render: (_, [, tech]) => <>{getLocaleName(tech)}</>,
				},
				{
					title: "Level",
					key: "level",
					sorter: ([, , l], [, , r]) => Math.floor(l) - Math.floor(r),
					render: (_, [, , level]) => numberFormat.format(Math.floor(level) + 1),
				},
				{
					title: "Progress",
					key: "progress",
					align: "right",
					sorter: ([, , l], [, , r]) => (l - Math.floor(l)) - (r - Math.floor(r)),
					render: (_, [, , level]) => <Progress percent={(level - Math.floor(level)) * 100} />,
				},
			]}
			dataSource={filter ? database.filter(filter) : database}
			rowKey={([force, tech]) => `${force}/${tech}`}
			pagination={false}
		/>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	database: TechDatabase = new TechDatabase();
	callbacks: (() => void)[] = [];

	private rewrite(techs: Tech[]) {
		for (const { force, tech, level } of techs) {
			this.database.set(force, tech, level);
		}
		for (const callback of this.callbacks) {
			callback();
		}
		console.log(this.database);
	}

	private async handleWriteTechsEvent(event: WriteTechsEvent) {
		this.rewrite(event.techs);
	}

	private updateSubscription() {
		if (!this.control.connector.connected) {
			return;
		}

		this.control
			.send(new UpdateDatabaseSubscriptionRequest(Boolean(this.callbacks.length)))
			.catch(notifyErrorHandler("Error subscribing to database"));

		if (this.callbacks.length) {
			this.control!.send(new ReadTechsRequest())
				.then(items => this.rewrite(items))
				.catch(notifyErrorHandler("Error updating database"));
		} else {
			this.database.clear();
		}
	}

	async init() {
		this.pages = [
			{
				path: "/research",
				sidebarName: "Research",
				permission: "research_sync.technologies.view",
				content: <TechsPage />,
			},
		];
		this.control.handle(WriteTechsEvent, this.handleWriteTechsEvent.bind(this));
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
