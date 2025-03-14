local clusterio_api = require("modules/clusterio/api")
local mod_gui = require("mod-gui")


local function on_server_startup()
    if not global.server_select then
        global.server_select = {}
    end
    if not global.server_select.instances then
        global.server_select.instances = {}
    end
    if not global.server_select.guis then
        global.server_select.guis = {}
    end
    if not global.server_select.search_terms then
        global.server_select.search_terms = {}
    end
end

local function get_this_instance()
    local instance_id = clusterio_api.get_instance_id()
    return instance_id and global.server_select.instances[instance_id]
end

-- Perform fuzzy text comparison
local function search_matches(instance_name, search_term)
    if search_term == "" then return true end
    search_term = search_term:lower()
    instance_name = instance_name:lower()
    local search_index = 1
    for i = 1, #instance_name do
        if instance_name:sub(i, i) == search_term:sub(search_index, search_index) then
            search_index = search_index + 1
            if search_index > #search_term then
                return true
            end
        end
    end
    return false
end

local function server_select_gui(player)
    local this_instance = get_this_instance()
    if not this_instance then
        this_instance = {
            id = clusterio_api.get_instance_id(),
            name = clusterio_api.get_instance_name(),
            status = "running",
            game_version = game.active_mods.base,
        }
        global.server_select.instances[this_instance.id] = this_instance
    end

    local frame_flow = mod_gui.get_frame_flow(player)
    local gui = frame_flow.add {
        type = "frame",
        name = "server_select-frame",
        direction = "vertical",
        caption = 'Server Select',
        style = mod_gui.frame_style,
    }
    global.server_select.guis[player.index] = gui
    player.opened = gui

    local instances = {}
    for id, instance in pairs(global.server_select.instances) do
        table.insert(instances, instance)
    end

    table.sort(instances, function(a, b) return a.name < b.name end)

    local row_count = math.ceil(#instances / math.ceil(#instances / 10))
    local columns = {}
    for index, instance in ipairs(instances) do
        local column_index = 1 + math.floor((index-1) / row_count)
        if not columns[column_index] then
            columns[column_index] = {}
        end
        table.insert(columns[column_index], instance)
    end

    -- Render search field
    local search_flow = gui.add {
        type = "flow",
        name = "server_select-search_flow",
        direction = "horizontal",
    }
    search_flow.add {
        type = "label",
        caption = "Search: ",
    }
    local search_field = search_flow.add {
        type = "textfield",
        name = "server_select-search",
        text = global.server_select.search_terms[player.index] or "",
    }

    -- Render scroll-pane with instances
    local scroll = gui.add {
        type = "scroll-pane",
        name = "server_select-scroll",
        direction = "vertical",
        horizontal_scroll_policy = "never",
        vertical_scroll_policy = "always",
    }
    scroll.style.maximal_height = 700
    scroll.style.minimal_width = 200

    -- Add instance buttons to scroll pane
    for index, instance in ipairs(instances) do
        local button = scroll.add {
            type = "button",
            name = "server_select-instance-" .. instance.id,
            caption = instance.name,
            visible = search_matches(instance.name, global.server_select.search_terms[player.index] or "")
        }

        if instance.id == this_instance.id then
            button.enabled = false
            button.style = "green_button"
            button.tooltip = "You are here"

        elseif instance.status == "unknown" then
            button.enabled = instance.game_port ~= nil
            button.style.font_color = { r = 0.65 }
            button.style.hovered_font_color = { r = 0.65 }
            button.style.clicked_font_color = { r = 0.65 }
            button.style.disabled_font_color = { r = 0.75, g = 0.1, b = 0.1 }
            button.tooltip = "Unknown status for this server"

        elseif instance.status ~= "running" then
            button.enabled = false
            button.tooltip = "This server is offline"

        elseif instance.game_version ~= this_instance.game_version then
            button.enabled = false
            button.style = "red_button"
            button.tooltip = "On Factorio version " .. instance.game_version
        end

        button.style.minimal_width = 72
        button.style.horizontal_align = "left"
        button.style.horizontally_stretchable = true
    end

    -- Move focus to search field if the user is searching for something
    if global.server_select.search_terms[player.index] then
        search_field.focus()
    end
end

local function on_gui_text_changed(event)
    if not (event.element and event.element.valid) then return end
    if event.element.name == "server_select-search" then
        global.server_select.search_terms[event.player_index] = event.element.text
        
        -- Filter search results
        local player = game.get_player(event.player_index)
        local gui = global.server_select.guis[event.player_index]
        if gui then
            local scroll = gui["server_select-scroll"]
            if scroll then
                for _, child in pairs(scroll.children) do
                    if child.type == "button" then
                        child.visible = search_matches(child.caption, event.element.text)
                    end
                end
            end
        end
    end
end

local function toggle_server_select_gui(player_index)
    local player = game.get_player(player_index)

    if global.server_select.guis[player_index] then
        global.server_select.guis[player_index].destroy()
        global.server_select.guis[player_index] = nil
        player.opened = nil

    else
        server_select_gui(player)
    end
end

local function checkbutton(e)
    local player = game.get_player(e.player_index)
    local anchorpoint = mod_gui.get_button_flow(player)

    local button = anchorpoint["server_select-button"]
    if button then
        button.destroy()
        button = nil
    end

    if not button then
        button = anchorpoint.add {
            type = "sprite-button",
            name = "server_select-button",
            sprite = "utility/surface_editor_icon",
            style = mod_gui.button_style,
            tooltip = ""
        }
    end
end

local function on_gui_click(event)
    if not (event.element and event.element.valid) then return end
    local element_name = event.element.name

    if element_name == "server_select-button" then
        toggle_server_select_gui(event.player_index)
        return
    end

    local match = element_name:match("^server_select%-instance%-(%d+)$")
    if match then
        local instance_id = tonumber(match)
        local instance = global.server_select.instances[instance_id]

        if instance and instance.game_port and instance.public_address then
            game.get_player(event.player_index).connect_to_server {
                address = instance.public_address .. ":" .. instance.game_port,
                name = instance.name
            }
            toggle_server_select_gui(event.player_index)
        end

        return
    end
end


local select = {}

select.events = {
    [clusterio_api.events.on_server_startup] = on_server_startup,
    [defines.events.on_player_joined_game] = checkbutton,
    [defines.events.on_gui_click] = on_gui_click,
    [defines.events.on_gui_text_changed] = on_gui_text_changed,
}

server_select = {}
function server_select.update_instances(data, full)
    if full then
        global.server_select.instances = {}
    end
    local instances = game.json_to_table(data)
    for _, instance in ipairs(instances) do
        if instance.removed then
            global.server_select.instances[instance.id] = nil
        else
            global.server_select.instances[instance.id] = instance
        end
    end

    -- Update open server lists
    for player_index, gui in pairs(global.server_select.guis) do
        gui.destroy()
        global.server_select.guis[player_index] = nil
        server_select_gui(game.get_player(player_index))
    end
end

return select
