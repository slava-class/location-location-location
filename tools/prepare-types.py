"""Generate per-run type overlays from checksum-pinned, shared API documents."""

from pathlib import Path
import hashlib
import re
import subprocess
import zipfile
from tools.helper_protocol import execute


def prepare(request):
    root = Path(request["repository"])
    overlay = Path(request["overlay"])
    api = request["api"]
    version = api["version"]
    for name in ("runtime", "prototype"):
        pin = api[name]
        path = Path(pin["path"])
        if (
            path.resolve() != path
            or not path.is_file()
            or path.stat().st_size > pin["maxBytes"]
        ):
            raise RuntimeError(f"Invalid supplied API file: {name}")
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != pin["sha256"]:
            raise RuntimeError(f"Supplied API checksum mismatch: {name}")
    overlay.mkdir(parents=True, exist_ok=False)
    generated = overlay / ("factorio-" + version)
    subprocess.run(
        [
            "bun",
            str(root / "node_modules/factoriomod-debug/dist/fmtk-cli.js"),
            "docs",
            "--docs",
            api["runtime"]["path"],
            "--protos",
            api["prototype"]["path"],
            "--docbase",
            f"https://lua-api.factorio.com/{version}",
            str(generated),
        ],
        check=True,
        cwd=root,
    )
    library = generated / "factorio/library"
    # Missing dictionary keys return nil. FMTK's table<string,T> omits that fact.
    for relative in [
        "runtime-api/LuaBootstrap.lua",
        "runtime-api/LuaPrototypes.lua",
        "runtime-api/LuaGameScript.lua",
    ]:
        path = library / relative
        source = path.read_text()
        if "Bootstrap" in relative:
            source = source.replace("table<string,string>", "table<string,string?>")
        else:
            source = re.sub(r"table<([^,>]+),([^>]+)>", r"table<\1,\2?>", source)
        path.write_text(source)
    # EmmyLua resolves literal @field keys but not variable GUI child names.
    # Model the same native index through table inheritance, as FMTK already
    # does for prototype dictionaries, including the documented missing-child nil.
    gui_element = library / "runtime-api/LuaGuiElement.lua"
    source = gui_element.read_text()
    class_header = "---@class LuaGuiElement:LuaObject.base, LuaGuiElement_funcs"
    index_field = "---@field [(string)|(uint)] LuaGuiElement"
    if source.count(class_header) != 1 or source.count(index_field) != 1:
        raise RuntimeError(
            "Generated GUI index declaration changed; review the adapter"
        )
    gui_element.write_text(
        source.replace(
            class_header,
            class_header + ", table<string|integer,LuaGuiElement?>",
        ).replace(index_field, "")
    )
    mods = library / "data/mods.lua"
    mods.write_text(
        mods.read_text().replace("{[string]: string}", "{[string]: string?}")
    )
    if request["storageType"] is not None:
        storage = library / "runtime/storage.lua"
        storage.write_text(
            storage.read_text().replace(
                "---@type table", "---@type " + request["storageType"]
            )
        )
    dependencies = []
    flib = request["flib"]
    if flib is not None:
        archive = Path(flib["archive"])
        if hashlib.sha256(archive.read_bytes()).hexdigest() != flib["sha256"]:
            raise RuntimeError("flib archive checksum mismatch")
        dependency_root = overlay / "dependencies"
        prefix = "flib_" + flib["version"]
        with zipfile.ZipFile(archive) as package:
            for item in package.infolist():
                if item.is_dir() or not item.filename.endswith(".lua"):
                    continue
                target = (dependency_root / item.filename).resolve()
                if not target.is_relative_to((dependency_root / prefix).resolve()):
                    raise RuntimeError("Unsafe or unexpected flib archive path")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(package.read(item))
        dependencies.append(str(dependency_root / prefix))
        gui = dependency_root / prefix / "gui.lua"
        source = gui.read_text()
        if flib["styleType"] is not None:
            source = source.replace(
                "style_mods LuaStyle?", "style_mods " + flib["styleType"] + "?"
            )
        # EmmyLua does not support LuaLS union inheritance. Preserve its complete
        # native field vocabulary while accepting heterogeneous flib definitions.
        source = re.sub(
            r"--- @class flib.GuiElemDef:.*", "--- @class flib.GuiElemDef", source
        )
        fields = {}
        active = False
        for line in (
            (library / "runtime-api/LuaGuiElement.lua").read_text().splitlines()
        ):
            if line.startswith("---@class"):
                active = "LuaGuiElement.add_param." in line
            if active and line.startswith("---@field "):
                match = re.match(r"---@field (\w+)\?? (.+)", line)
                if match:
                    fields.setdefault(match[1], set()).add(match[2])
        definitions = "\n".join(
            "--- @field "
            + name
            + (" " if name == "type" else "? ")
            + "|".join("(" + item + ")" for item in sorted(types))
            for name, types in fields.items()
        )
        gui.write_text(
            source.replace(
                "--- @class flib.GuiElemDef",
                "--- @class flib.GuiElemDef\n" + definitions,
            )
        )
    return {
        "schema": 1,
        "version": version,
        "library": str(library),
        "dependencies": dependencies,
    }


if __name__ == "__main__":
    execute(prepare)
