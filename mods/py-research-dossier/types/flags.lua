---@meta

---@alias DossierKind "item"|"recipe"|"fluid"|"entity"|"technology"|"tile"
---@alias DossierPrototype LuaItemPrototype|LuaEntityPrototype|LuaRecipePrototype|LuaFluidPrototype|LuaTechnologyPrototype|LuaTilePrototype

---@class DossierTarget
---@field base_type DossierKind
---@field type string
---@field name string
---@field id string

-- These named children are constructed together by flag-gui.open; the model
-- suite also exercises the released 0.3.0 selection-row migration.
---@class DossierSelection: LuaGuiElement
---@field kind LuaGuiElement
---@field picker LuaGuiElement

---@class DossierBody: LuaGuiElement
---@field selection DossierSelection
---@field recipes LuaGuiElement
---@field note LuaGuiElement

---@class DossierWindow: LuaGuiElement
---@field body DossierBody
