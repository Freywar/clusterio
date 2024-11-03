local clusterio_api = require("modules/clusterio/api")

local sync = {}


local function get_technology_progress(tech)
	if tech == tech.force.current_research then
		return tech.force.research_progress
	else
		return tech.force.get_saved_technology_progress(tech.name)
	end
end

local function set_technology_progress(tech, progress)
	if tech == tech.force.current_research then
		tech.force.research_progress = progress
	else
		tech.force.set_saved_technology_progress(tech.name, progress)
	end
end

local function get_technology(forceName, techName)
	return (global.research_sync.technologies[forceName] or {})[techName]
end

local function set_technology(forceName, techName, tech)
	global.research_sync.technologies[forceName] = global.research_sync.technologies[forceName] or {}
	global.research_sync.technologies[forceName][techName] = tech
end

sync.events = {}
sync.events[clusterio_api.events.on_server_startup] = function(event)
	if not global.research_sync then
		global.research_sync = {
			technologies = {},
		}
	end

	-- Used when syncing completed technologies from the controller
	global.research_sync.ignore_research_finished = false

	for _, force in pairs(game.forces) do
		for _, tech in pairs(force.technologies) do
			local progress = get_technology_progress(tech)
			set_technology(force.name, tech.name, {
				level = tech.level,
				researched = tech.researched,
				progress = progress,
			})
		end
	end
end

local function get_contribution(tech)
	local progress = get_technology_progress(tech)
	if not progress then
		return 0, nil
	end

	local prev_tech = get_technology(tech.force.name, tech.name)
	if prev_tech.progress and prev_tech.level == tech.level then
		return progress - prev_tech.progress, progress
	else
		return progress, progress
	end
end

local function send_contribution(tech)
	local contribution, progress = get_contribution(tech)
	if contribution ~= 0 then
		clusterio_api.send_json("research_sync:contribution", {
			force = tech.force.name,
			name = tech.name,
			level = tech.level,
			contribution = contribution,
		})
		get_technology(tech.force.name, tech.name).progress = progress
	end
end

sync.events[defines.events.on_research_started] = function(event)
	local tech = event.last_research
	if tech then
		send_contribution(tech)
	end
end

sync.events[defines.events.on_research_finished] = function(event)
	if global.research_sync.ignore_research_finished then
		return
	end

	local tech = event.research
	set_technology(tech.force.name, tech.name, {
		level = tech.level,
		researched = tech.researched,
	})

	local level = tech.level
	if not tech.researched then
		level = level - 1
	end

	clusterio_api.send_json("research_sync:finished", {
		force = tech.force.name,
		name = tech.name,
		level = level,
	})
end

sync.on_nth_tick = {}
sync.on_nth_tick[79] = function(event)
	for _, force in pairs(game.forces) do
		local tech = force.current_research
		if tech then
			send_contribution(tech)
		end
	end
end

research_sync = {}
function research_sync.dump_technologies()
	local techs = {}
	for _, force in pairs(game.forces) do
		for _, tech in pairs(force.technologies) do
			table.insert(techs, {
				force = force.name,
				name = tech.name,
				level = tech.level,
				progress = get_technology_progress(tech),
				researched = tech.researched,
			})
		end
	end

	if #techs == 0 then
		rcon.print("[]")
	else
		rcon.print(game.table_to_json(techs))
	end
end

function research_sync.sync_technologies(data)
	local forceIndex = 1
	local nameIndex = 2
	local levelIndex = 3
	local progressIndex = 4
	local researchedIndex = 5

	global.research_sync.ignore_research_finished = true
	for _, tech_data in pairs(game.json_to_table(data)) do
		local force = game.forces[tech_data[forceIndex]]
		local tech = force.technologies[tech_data[nameIndex]]
		if tech and tech.level <= tech_data[levelIndex] then
			local new_level = math.min(tech_data[levelIndex], tech.prototype.max_level)
			if new_level ~= tech.level then
				-- when the level of the current research changes the
				-- progress is not automatically reset.
				if force.current_research == tech then
					force.research_progress = 0
				end
				tech.level = new_level
			end

			local progress
			if tech_data[researchedIndex] then
				if force.current_research == tech then
					force.research_progress = 0
				end
				tech.researched = true
				progress = nil
			elseif tech_data[progressIndex] then
				send_contribution(tech)
				progress = tech_data[progressIndex]
				set_technology_progress(tech, progress)
			else
				progress = get_technology_progress(tech)
			end

			set_technology(force.name, tech.name, {
				level = tech.level,
				researched = tech.researched,
				progress = progress,
			})
		end
	end
	global.research_sync.ignore_research_finished = false
end

function research_sync.update_progress(data)
	for _, row in ipairs(game.json_to_table(data)) do
		local force = game.forces[row.force]
		local tech = force.technologies[row.name]
		if tech and tech.level == row.level then
			send_contribution(tech)
			set_technology_progress(tech, row.progress)
			set_technology(force.name, tech.name, {
				level = tech.level,
				progress = row.progress
			})
		end
	end
end

function research_sync.research_technology(forceName, techName, level)
	local force = game.forces[forceName]
	local tech = force.technologies[techName]
	if not tech or tech.level > level then
		return
	end

	if level > tech.prototype.max_level then
		level = tech.prototype.max_level
	end

	global.research_sync.ignore_research_finished = true
	if tech == force.current_research and tech.level == level then
		force.research_progress = 1

	elseif tech.level < level or tech.level == level and not tech.researched then
		tech.level = level
		tech.researched = true

		if tech.name:find("-%d+$") then
			game.print {"", "Researched ", {"technology-name." .. tech.name:gsub("-%d+$", "")}, " ", level}
		else
			game.print {"", "Researched ", {"technology-name." .. tech.name}}
		end
		game.play_sound { path = "utility/research_completed" }
	end
	global.research_sync.ignore_research_finished = false

	set_technology(force.name, tech.name, {
		level = tech.level,
		researched = tech.researched,
	})
end


return sync
