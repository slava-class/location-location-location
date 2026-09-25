local tag_table = {}

---Holds the information needed to create a map tag, along with an `enabled` bool and associated train stop name (if any).
---@class TagTable
---@field signal SignalID
---@field enabled boolean
---@field position MapPosition.0
---@field text string
---@field train_stop? string The backer_name of the associated train stop.

---TagTable constructor.
--- - `position` defaults to `{x = 0, y = 0}`.
--- - `text` defaults to `""`.
--- - `train_stop` is the backer_name of the associated train stop (if any), and defaults to `nil`.
---@param args { signal: SignalID, enabled: boolean, position: MapPosition.0?, text: string?, train_stop: string? }
---@return TagTable
tag_table.new = function(args)
    return {
        train_stop = args.train_stop or nil,
        signal = args.signal,
        enabled = args.enabled,
        position = args.position or {x = 0, y = 0},
        text = args.text or "",
    }
end

return tag_table