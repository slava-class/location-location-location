local Scan = {}

function Scan.start(area, focus, size)
    local left, top = area[1][1], area[1][2]
    local right, bottom = area[2][1], area[2][2]
    local cells = {}
    if left <= right and top <= bottom then
        for y = math.floor(top / size), math.floor(bottom / size) do
            for x = math.floor(left / size), math.floor(right / size) do
                cells[#cells + 1] = {
                    area = {
                        { math.max(left, x * size), math.max(top, y * size) },
                        { math.min(right, (x + 1) * size), math.min(bottom, (y + 1) * size) },
                    },
                    x = x,
                    y = y,
                    distance = ((x + 0.5) * size - focus.x) ^ 2 + ((y + 0.5) * size - focus.y) ^ 2,
                }
            end
        end
    end
    table.sort(cells, function(a, b)
        if a.distance ~= b.distance then
            return a.distance < b.distance
        end
        if a.y ~= b.y then
            return a.y < b.y
        end
        return a.x < b.x
    end)
    return { cells = cells, cell = 1, pending = {}, pending_index = 1, seen = {} }
end

-- One spatial cell per call. Return indices into the retained native result,
-- rather than allocating another candidate array or truncating a dense cell.
---@param budget integer
---@return integer, integer, integer, boolean
function Scan.next(scan, surface, types, include_ghosts, budget)
    local queries = 0
    if scan.pending_index > #scan.pending then
        local cell = scan.cells[scan.cell]
        if not cell then
            return 1, 0, 0, true
        end
        scan.cell = scan.cell + 1
        scan.pending = surface.find_entities_filtered({ area = cell.area, type = types })
        queries = 1
        if include_ghosts then
            for _, ghost in ipairs(surface.find_entities_filtered({ area = cell.area, ghost_type = types })) do
                scan.pending[#scan.pending + 1] = ghost
            end
            queries = 2
        end
        scan.pending_index = 1
    end
    local first = scan.pending_index
    local last = math.min(#scan.pending, first + budget - 1) --[[@as integer]]
    scan.pending_index = last + 1
    return first, last, queries, false
end

return Scan
