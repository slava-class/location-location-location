---@meta

---@class NoAltNeededPreferences
---@field hover boolean
---@field nearby boolean
---@field nearby_focus "pointer"|"retain"|"grace"|"selection"
---@field radius integer
---@field resources string
---@field electricity string
---@field ammo_counts string
---@field auto_alt boolean
---@field inserter_capacity boolean
---@field warnings "off"|"hover"|"alt"|"always"
---@field warning_inserters boolean
---@field warning_drills boolean
---@field warning_fluids "off"|"issues"|"full"
---@field warning_ignored table<string, boolean>

---@class NoAltNeededRecipe
---@field name string
---@field quality string
---@field unavailable boolean

---@class NoAltNeededSnapshot
---@field groups table[]
---@field details LocalisedString[]
---@field quality string
---@field recipe NoAltNeededRecipe?
---@field filter_mode string?
---@field operator string?
---@field electricity {production:number,demand:number,satisfaction:number}?
---@field charge number?

---@class NoAltNeededGroupLayout
---@field group table
---@field columns integer
---@field rows integer
---@field cell number
---@field icon_size number
---@field top number
---@field left number
---@field overflow boolean
---@field maximum integer

---@class NoAltNeededRenderState
---@field objects LuaRenderObject[]?
---@field signature string?
---@field entity LuaEntity?
---@field snapshot NoAltNeededSnapshot?
---@field draw_recipe boolean?

---@class NoAltNeededPlayerState
---@field exact NoAltNeededRenderState
---@field nearby table
---@field pointer table
---@field fluid table
---@field capacity table
---@field warnings table
---@field auto_alt table
---@field preferences NoAltNeededPreferences
---@field selected LuaEntity?
---@field surface uint32?
---@field force uint32?
---@field alt boolean?
---@field blocked boolean?
---@field next_refresh MapTick?

---@class NoAltNeededStorage
---@field schema integer
---@field players table<uint32, NoAltNeededPlayerState?>
---@field active table<uint32, boolean?>
---@field world_version integer
---@field capabilities table

---@class NoAltNeededExperimentsHeader: LuaGuiElement
---@field close LuaGuiElement

---@class NoAltNeededExperimentsBody: LuaGuiElement
---@field controls LuaGuiElement

---@class NoAltNeededExperimentsFrame: LuaGuiElement
---@field header NoAltNeededExperimentsHeader
---@field body NoAltNeededExperimentsBody

---@alias NoAltNeededRemoteSettingCall fun(interface:string, method:"set", player_index:uint32, name:string, value:boolean|string):boolean|string

---@class NoAltNeededWarningRecord
---@field entity LuaEntity
---@field key uint32
---@field slot integer
---@field next_refresh integer
---@field generation integer?
---@field pickup MapPosition?
---@field drop MapPosition?
---@field pickup_key string?
---@field drop_key string?
---@field pickup_served boolean?
---@field drop_served boolean?
---@field snapshot table[]?
---@field objects LuaRenderObject[]?
---@field signature string?
---@field top number?
