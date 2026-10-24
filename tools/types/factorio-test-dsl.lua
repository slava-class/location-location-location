---@meta
-- Public FactorioTest 3.1 DSL; implemented by the pinned FactorioTest library.
---@class FactorioTestBuilder
---@field after_reload_mods fun(body: fun()): FactorioTestBuilder
---@field after_reload_script fun(body: fun()): FactorioTestBuilder
---@param name string
---@param body fun()
function describe(name, body) end
---@param name string
---@param body fun()
---@return FactorioTestBuilder
function test(name, body) end
---@param ... string
function tags(...) end
---@param body fun()
function before_all(body) end
---@param body fun()
function before_each(body) end
---@param body fun()
function after_each(body) end
---@param body fun()
function after_all(body) end
---@param ticks integer
---@param body fun()
function after_ticks(ticks, body) end
---@param ticks integer
function ticks_between_tests(ticks) end
---@param timeout integer?
function async(timeout) end
function done() end
