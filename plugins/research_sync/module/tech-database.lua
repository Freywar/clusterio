local TechDatabase = {}
TechDatabase.__index = TechDatabase

script.register_metatable("research_sync__tech_database", TechDatabase)

function TechDatabase:new()
	local o = { data = {} }
	setmetatable(o, TechDatabase)
	return o
end

function TechDatabase:set(force, tech, entry)
	self.data[force] = self.data[force] or {}
	self.data[force][tech] = entry
end

function TechDatabase:get(force, tech)
	return self.data[force] and self.data[force][tech]
end

function TechDatabase:update(force, tech, f)
	self:set(force, tech, f(self:get(force, tech)))
end

function TechDatabase:delete(force, tech)
	if self.data[force] then
		self.data[force][tech] = nil
	end
end

function TechDatabase:clear()
	self.data = {}
end

function TechDatabase:next(i)
	i = i + 1
	if i > #self then
		return nil, nil, nil, nil, nil, nil
	end
	return i, self[i].force, self[i].tech, self[i].entry
end

function TechDatabase:entries()
	local entries = {}
	for force, techs in pairs(self.data) do
		for tech, entry in pairs(techs) do
			table.insert(entries, { force = force, tech = tech, entry = entry })
		end
	end

	return self.next, entries, 0
end

return TechDatabase
