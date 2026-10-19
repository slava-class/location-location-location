local appearance = {
    sprite = "reversed_underground_belt_detector_warning_arrow",
    mouth_scale = 1,
    span_scale = 0.9,
    mouth_tint = { r = 1, g = 0.34, b = 0, a = 1 },
    span_tint = { r = 1, g = 0.34, b = 0, a = 0.75 },
    pulse_interval = 6,
    pulse_period = 216,
    mouth_pulse_floor = 0.6,
    span_pulse_floor = 0.6,
}

function appearance.register()
    local triangle = {
        filename = "__core__/graphics/arrows/underground-lines.png",
        x = 78,
        y = 23,
        width = 36,
        height = 20,
        scale = 0.5,
    }
    -- Yellow + its additive blue complement preserves alpha while producing a
    -- neutral mask, so runtime tint controls every color channel.
    local complement = table.deepcopy(triangle)
    complement.invert_colors = true
    complement.blend_mode = "additive"
    data:extend({ { type = "sprite", name = appearance.sprite, layers = { triangle, complement } } })
end

return appearance
