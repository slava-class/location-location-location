return {
    std = "lua52",
    max_line_length = 140,
    exclude_files = { "node_modules/**", ".factorio-test/**", "types/**" },
    stds = {
        workshop_factorio = {
            read_globals = { "table_size", table = { fields = { deepcopy = {} } } },
        },
        workshop_runtime = {
            read_globals = { "game", "script", "defines", "prototypes", "rendering", "helpers", "settings" },
        },
        workshop_tests = {
            read_globals = {
                "serpent",
                "tags",
                "describe",
                "test",
                "before_all",
                "before_each",
                "after_each",
                "after_all",
                "after_ticks",
                "ticks_between_tests",
                "async",
                "done",
            },
        },
    },
}
