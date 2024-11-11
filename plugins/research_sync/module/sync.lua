local clusterio_api = require("modules/clusterio/api")



local TechMap = {}

function TechMap:new(default)
	local techmap = { ["__default__"] = default }
	setmetatable(techmap, self)
	self.__index = self
	return techmap
end

function TechMap.parse(data, default)
	local techmap = TechMap:new(default)
	for _, item in ipairs(data) do
		techmap:set(item[1], item[2], item[3])
	end
	return techmap
end

function TechMap:set(force, name, data)
	self[force] = self[force] or {}
	self[force][name] = data
	if self[force][name] == self["__default__"] then
		self[force][name] = nil
	end
	if not next(self[force]) then
		self[force] = nil
	end
end

function TechMap:get(force, name)
	return self[force]
			and self[force][name]
			or self["__default__"]
end

function TechMap:update(force, name, f)
	self:set(force, name, f(self:get(force, name)))
end

function TechMap:serialize()
	local result = {}
	for force, techs in pairs(self) do
		for name, data in pairs(techs) do
			table.insert(result, { force, name, data })
		end
	end
	return result
end

function TechMap:entries()
	local entries = self:serialize() -- TODO Avoid creating an array
	local i = 0
	return function()
		i = i + 1
		if i > #entries then
			return nil, nil, nil
		end
		return entries[i][1], entries[i][2], entries[i][3]
	end
end

local function get_progress(tech)
	if tech.researched then
		return 1
	elseif tech == tech.force.current_research then
		return tech.force.research_progress
	else
		return tech.force.get_saved_technology_progress(tech.name)
	end
end

local function set_progress(tech, progress)
	if progress>=1 then
		
	elseif tech == tech.force.current_research then
		tech.force.research_progress = progress
	else
		tech.force.set_saved_technology_progress(tech.name, progress)
	end
end




local function get_advancement(tech)
	local progress = get_progress(tech)
	if not progress then
		return 0, progress
	end

	local prev_tech = global.research_sync.techs:get(tech.force.name, tech.name)
	if prev_tech.level == tech.level and prev_tech.progress then
		return progress - prev_tech.progress, progress
	else
		return progress, progress
	end
end

local function send_advancement(curr_tech)
	local progress = get_progress(curr_tech)
	if (progress or 0) == 0 then
		return
	end

	local advancement
	local prev_tech = global.research_sync.techs:get(curr_tech.force.name, curr_tech.name)
	if prev_tech.level == curr_tech.level and progress ~= prev_tech.progress then
		if progress ~= prev_tech.progress then
			clusterio_api.send_json("research_sync:advancement", {
				force = curr_tech.force.name,
				name = curr_tech.name,
				level = curr_tech.level,
				advancement = progress - (prev_tech.progress or 0),
			})
			global.research_sync.techs:get(curr_tech.force.name, curr_tech.name).progress = progress
		end
	else
		clusterio_api.send_json("research_sync:advancement", {
			force = curr_tech.force.name,
			name = curr_tech.name,
			level = curr_tech.level,
			advancement = progress,
		})
	end
end


local research_sync = {
	events = {},
	on_nth_tick = {}
}

research_sync.events[clusterio_api.events.on_server_startup] = function()
	global.research_sync = global.research_sync or { technologies = {} }
	global.research_sync.locked = false -- Techs are being handled by the plugin, no event should be handled.

	local force = game.forces["player"]
	for _, tech in pairs(force.technologies) do
		global.research_sync.techs[tech.name] = {
			level = tech.level,
			researched = tech.researched,
			progress = get_progress(tech),
		}
	end
end

research_sync.events[defines.events.on_research_started] = function(event)
	if global.research_sync.locked or not event.last_research then
		return
	end

	local contribution, progress = get_advancement(event.last_research)
	if contribution ~= 0 then
		clusterio_api.send_json("research_sync:contribution", {
			name = event.last_research.name,
			level = event.last_research.level,
			contribution = contribution,
		})
		global.research_sync.techs[event.last_research.name].progress = progress
	end
end

research_sync.events[defines.events.on_research_finished] = function(event)
	if global.research_sync.locked then
		return
	end

	local tech = event.research
	global.research_sync.techs[tech.name] = {
		level = tech.level,
		researched = tech.researched,
	}

	local level = tech.level
	if not tech.researched then
		level = level - 1
	end

	clusterio_api.send_json("research_sync:finished", {
		name = tech.name,
		level = level,
	})
end

research_sync.on_nth_tick[79] = function()
	local tech = game.forces["player"].current_research
	if tech then
		send_advancement(tech)
	end
end

function research_sync.get_technologies()
	local techs = {}
	for _, force in game.forces do
		for _, tech in pairs(force.technologies) do
			table.insert(techs, {
				name = tech.name,
				level = tech.level or 1,
				progress = get_progress(tech),
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

function research_sync.set_technologies(data)
	local force = game.forces["player"]

	local nameIndex = 1
	local levelIndex = 2
	local progressIndex = 3
	local researchedIndex = 4

	global.research_sync.locked = true
	for _, tech_data in pairs(game.json_to_table(data)) do
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
				send_advancement(tech)
				progress = tech_data[progressIndex]
				set_progress(tech, progress)
			else
				progress = get_progress(tech)
			end

			global.research_sync.techs[tech.name] = {
				level = tech.level,
				researched = tech.researched,
				progress = progress,
			}
		end
	end
	global.research_sync.locked = false
end

function research_sync.update_progress(data)
	local techs = game.json_to_table(data)
	local force = game.forces["player"]

	for _, controllerTech in ipairs(techs) do
		local tech = force.technologies[controllerTech.name]
		if tech and tech.level == controllerTech.level then
			send_advancement(tech)
			set_progress(tech, controllerTech.progress)
			global.research_sync.techs[tech.name] = {
				level = tech.level,
				progress = controllerTech.progress
			}
		end
	end
end

function research_sync.research_technology(name, level)
	local force = game.forces["player"]
	local tech = force.technologies[name]
	if not tech or tech.level > level then
		return
	end

	if level > tech.prototype.max_level then
		level = tech.prototype.max_level
	end

	global.research_sync.locked = true
	if tech == force.current_research and tech.level == level then
		force.research_progress = 1
	elseif tech.level < level or tech.level == level and not tech.researched then
		tech.level = level
		tech.researched = true

		if tech.name:find("-%d+$") then
			game.print { "", "Researched ", { "technology-name." .. tech.name:gsub("-%d+$", "") }, " ", level }
		else
			game.print { "", "Researched ", { "technology-name." .. tech.name } }
		end
		game.play_sound { path = "utility/research_completed" }
	end
	global.research_sync.locked = false

	global.research_sync.techs[tech.name] = {
		level = tech.level,
		researched = tech.researched,
	}
end

return research_sync
