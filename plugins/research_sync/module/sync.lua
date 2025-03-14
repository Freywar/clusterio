local TechDatabase = require("modules/research_sync/tech-database")
local clusterio_api = require("modules/clusterio/api")

-- Normalized level starting from 0, e.g. `automation` in progress is `0.3`, unlocked `automation` is `1`,
-- `mining-productivity-4` level 8 in progress is `7.3`, and `mining-productivity-4` level 8 unlocked is `8`.
local function get_technology_absolute_level(tech)
	return tech.level - 1
			+ (tech.researched and 1 or 0)
			+ (tech == tech.force.current_research and tech.force.research_progress
				or tech.force.get_saved_technology_progress(tech.name)
				or 0)
end

local function set_technology_absolute_level(tech, level)
	if level <= get_technology_absolute_level(tech) then
		return
	end

	local base = math.floor(level)
	local progress = level - base

	if tech.level == tech.prototype.max_level then
		-- finite tech, can be `researched`
		if base == tech.level - 1 then
			if tech == tech.force.current_research then
				tech.force.research_progress = progress
			else
				tech.force.set_saved_technology_progress(tech.name, progress)
			end
		elseif base == tech.level and not tech.researched then
			if tech.force.current_research == tech then
				tech.force.research_progress = 1
			else
				tech.researched = true
				game.print { "", "Researched ", { "technology-name." .. (tech.name:find("-%d+$") and tech.name:gsub("-%d+$", "") or tech.name) } }
				game.play_sound { path = "utility/research_completed" }
			end
		else
			-- Weird
		end
	else
		-- infinite tech, jumps to next unresearched level
		if tech.level < base + 1 then
			tech.level = base + 1
			if tech == tech.force.current_research then
				game.print { "", "Researched ", { "technology-name." .. (tech.name:find("-%d+$") and tech.name:gsub("-%d+$", "") or tech.name) } }
				game.play_sound { path = "utility/research_completed" }
			end
		end
		if tech == tech.force.current_research then
			tech.force.research_progress = progress
		else
			tech.force.set_saved_technology_progress(tech.name, progress)
		end
	end
	global.research_sync.snapshot:set(tech.force.name, tech.name, level)
end

local function send_progress(tech)
	if not tech then
		return
	end

	local previous = global.research_sync.snapshot:get(tech.force.name, tech.name)
	local current = get_technology_absolute_level(tech)

	if current <= previous then
		return
	end

	clusterio_api.send_json("research_sync:progress", {
		{
			tech.force.name,
			tech.name,
			previous,
			current - previous,
		}
	})

	global.research_sync.snapshot:set(tech.force.name, tech.name, current)
end


local sync = {
	events = {},
	on_nth_tick = {},
}

sync.events[clusterio_api.events.on_server_startup] = function()
	global.research_sync = global.research_sync or { snapshot = TechDatabase:new() }
	for _, force in pairs(game.forces) do
		for _, tech in pairs(force.technologies) do
			global.research_sync.snapshot:set(force.name, tech.name, get_technology_absolute_level(tech))
		end
	end

	-- Ignore any changes in techs caused by synchronizing them to external data
	global.research_sync.syncing = false
end

sync.events[defines.events.on_research_started] = function(event)
	if global.research_sync.syncing then
		return
	end
	send_progress(event.last_research)
end

sync.on_nth_tick[79] = function()
	if global.research_sync.syncing then
		return
	end
	for _, force in pairs(game.forces) do
		send_progress(force.current_research)
	end
end

sync.events[defines.events.on_research_finished] = function(event)
	if global.research_sync.syncing then
		return
	end

	send_progress(event.research)
end

research_sync = {}

function research_sync.read_techs()
	local techs = {}
	for _, force, tech, level in global.research_sync.snapshot:entries() do
		table.insert(techs, { force, tech, level })
	end
	rcon.print(game.table_to_json({ techs = techs }))
end

function research_sync.write_techs(data)
	local force_index = 1
	local tech_index = 2
	local level_index = 3

	global.research_sync.syncing = true
	for _, entry in ipairs(game.json_to_table(data)) do
		local tech = game.forces[entry[force_index]].technologies[entry[tech_index]]
		local current = get_technology_absolute_level(tech)
		local next = entry[level_index]
		if current < next then
			send_progress(tech)
			set_technology_absolute_level(tech, next)
		end
	end
	global.research_sync.syncing = false
end

return sync
