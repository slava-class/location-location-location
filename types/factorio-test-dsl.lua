---@meta
-- Public FactorioTest 3.1 DSL used by the native suite; implemented by FactorioTest.
---@param name string
---@param body fun()
function describe(name, body) end
---@param name string
---@param body fun()
function test(name, body) end
---@param ... string
function tags(...) end
---@param body fun()
function before_all(body) end
---@param body fun()
function before_each(body) end
---@param body fun()
function after_all(body) end
---@param ticks integer
---@param body fun()
function after_ticks(ticks, body) end
---@param ticks integer
function ticks_between_tests(ticks) end
