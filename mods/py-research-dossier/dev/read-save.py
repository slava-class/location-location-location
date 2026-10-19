"""Version-scoped Factorio force readback; no game invocation or profile writes.

Only the validated 2.1.21-11 layout and normal player/enemy/neutral forces are
supported. Structural ambiguity is an error, never a plausible partial result.
"""

import datetime
import hashlib
import io
from pathlib import Path
import struct
import zipfile
import zlib
from tools.helper_protocol import execute


def require(condition, message):
    if not condition:
        raise ValueError(message)


def prototype_table(data, kind):
    marker = bytes([len(kind)]) + kind.encode()
    candidates = []
    start = 0
    while True:
        pos = data.find(marker, start)
        if pos < 0:
            break
        start = pos + 1
        offset = pos + len(marker)
        try:
            count = struct.unpack_from("<H", data, offset)[0]
            offset += 2
            if not 0 < count < 65535:
                continue
            names = {}
            for _ in range(count):
                size = data[offset]
                offset += 1
                if size == 255:
                    size = struct.unpack_from("<I", data, offset)[0]
                    offset += 4
                require(0 < size < 500, "Invalid prototype name length")
                name = data[offset : offset + size].decode("utf-8")
                offset += size
                ident = struct.unpack_from("<H", data, offset)[0]
                offset += 2
                require(ident not in names, "Duplicate prototype ID")
                names[ident] = name
            if len(set(names.values())) == count and sorted(names) == list(
                range(1, count + 1)
            ):
                candidates.append((pos, offset, names))
        except (ValueError, IndexError, struct.error):
            continue
    require(
        len(candidates) == 1,
        f"{kind}: expected one validated prototype table, found {len(candidates)}",
    )
    return candidates[0]


def decode_forces(data):
    require(
        struct.unpack_from("<4H", data) == (2, 1, 21, 11),
        "Unsupported save layout; expected Factorio 2.1.21-11",
    )
    tpos, tend, technologies = prototype_table(data, "technology")
    rpos, rend, recipes = prototype_table(data, "recipe")
    headers = []
    for ident, name in ((1, "player"), (2, "enemy"), (3, "neutral")):
        marker = bytes([ident, len(name)]) + name.encode()
        pos = data.find(marker, max(tend, rend))
        require(
            pos >= 0 and data.find(marker, pos + 1) < 0,
            f"Missing/ambiguous normal force {name}",
        )
        headers.append((pos, name))
    headers.sort()
    forces = {}
    for index, (begin, name) in enumerate(headers):
        end = headers[index + 1][0] if index + 1 < len(headers) else len(data)
        marker = struct.pack("<H", len(recipes) + 1)
        candidates = []
        start = begin
        while True:
            pos = data.find(marker, start, end)
            if pos < 0:
                break
            start = pos + 1
            after = pos + 2 + 8 * len(recipes)
            if (
                after + 2 >= end
                or struct.unpack_from("<H", data, after)[0] != len(technologies) + 1
            ):
                continue
            enabled = data[pos + 6 : after : 8]
            if len(enabled) != len(recipes) or any(
                flag not in (0, 1) for flag in enabled
            ):
                continue
            offset = after + 2
            researched = []
            triggers = []
            try:
                for ident in range(1, len(technologies) + 1):
                    prefix, research, trigger = struct.unpack_from("<HBB", data, offset)
                    offset += 4
                    require(
                        prefix in (0, 1) and research in (0, 1) and trigger in (0, 1),
                        "Unsupported technology record",
                    )
                    if research:
                        researched.append(technologies[ident])
                    if trigger:
                        kind, progress = struct.unpack_from("<HI", data, offset)
                        offset += 6
                        require(kind == 0, "Unsupported research trigger")
                        triggers.append(
                            {
                                "technology": technologies[ident],
                                "kind": kind,
                                "progress": progress,
                            }
                        )
                require(offset <= end, "Technology vector crosses force boundary")
                candidates.append(
                    {
                        "recipeVectorOffset": pos,
                        "technologyVectorOffset": after,
                        "technologyVectorEnd": offset,
                        "enabledRecipes": [
                            recipes[i + 1] for i, value in enumerate(enabled) if value
                        ],
                        "researchedTechnologies": researched,
                        "triggers": triggers,
                    }
                )
            except (ValueError, IndexError, struct.error):
                continue
        require(
            len(candidates) == 1,
            f"{name}: expected one validated adjacent recipe/research vector, found {len(candidates)}",
        )
        forces[name] = candidates[0]
    return {
        "factorioVersion": "2.1.21-11",
        "decompressedBytes": len(data),
        "forces": forces,
        "prototypeMappings": {
            "recipe": {"offset": rpos, "end": rend, "count": len(recipes)},
            "technology": {"offset": tpos, "end": tend, "count": len(technologies)},
        },
        "recipePrototypeNames": list(recipes.values()),
        "technologyPrototypeNames": list(technologies.values()),
    }


def saved_mod_versions(archive):
    members = [name for name in archive.namelist() if name.endswith("/script.dat")]
    require(len(members) == 1, "Expected one saved script.dat")
    data = archive.read(members[0])
    require(
        struct.unpack_from("<4H", data) == (2, 1, 21, 11),
        "Unsupported script.dat layout",
    )

    def uint(blob, offset):
        value = blob[offset]
        offset += 1
        if value == 255:
            value = struct.unpack_from("<I", blob, offset)[0]
            offset += 4
        return value, offset

    def text(blob, offset):
        size, offset = uint(blob, offset)
        require(offset + size <= len(blob), "Truncated saved string")
        return blob[offset : offset + size].decode("utf-8"), offset + size

    count = struct.unpack_from("<I", data, 9)[0]
    offset = 13
    planner = None
    for _ in range(count):
        name, offset = text(data, offset)
        size, offset = uint(data, offset)
        require(offset + size < len(data), "Truncated saved mod state")
        if name == "mod-factoryplanner":
            require(planner is None, "Duplicate Factory Planner state")
            planner = data[offset : offset + size]
        offset += size + 1
    if offset != len(data) or planner is None:
        raise ValueError("Expected complete Factory Planner framing")
    require(
        struct.unpack_from("<4H", planner) == (2, 1, 21, 11),
        "Unsupported Factory Planner state layout",
    )
    field = b"installed_mods"
    marker = bytes([4, len(field)]) + field + bytes([5])
    position = planner.find(marker)
    require(
        position >= 0 and planner.find(marker, position + 1) < 0,
        "Missing/ambiguous saved installed_mods",
    )
    count, offset = uint(planner, position + len(marker))
    mods = {}
    for _ in range(count):
        require(planner[offset] == 4, "Expected saved mod-name string")
        name, offset = text(planner, offset + 1)
        require(planner[offset] == 4, "Expected saved mod-version string")
        version, offset = text(planner, offset + 1)
        require(name not in mods, "Duplicate saved mod")
        mods[name] = version
    return mods


def read_save(path):
    before = path.stat()
    blob = path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        chunks = sorted(
            (
                name
                for name in archive.namelist()
                if name.rsplit("/", 1)[-1].startswith("level.dat")
                and name.rsplit("level.dat", 1)[-1].isdigit()
            ),
            key=lambda name: int(name.rsplit("level.dat", 1)[-1]),
        )
        require(
            chunks
            and [int(name.rsplit("level.dat", 1)[-1]) for name in chunks]
            == list(range(len(chunks))),
            "Missing or ambiguous level.dat chunks",
        )
        result = decode_forces(
            b"".join(zlib.decompress(archive.read(name)) for name in chunks[:9])
        )
        result["modVersions"] = saved_mod_versions(archive)
    after = path.stat()
    require(
        (before.st_mtime_ns, before.st_size, before.st_ino)
        == (after.st_mtime_ns, after.st_size, after.st_ino),
        "Save changed during extraction",
    )
    result.update(
        {
            "kind": "version-scoped offline saved-force readback, not live engine state",
            "save": str(path),
            "saveBytes": before.st_size,
            "saveMtimeUtc": datetime.datetime.fromtimestamp(
                before.st_mtime, datetime.timezone.utc
            ).isoformat(),
            "saveSha256": hashlib.sha256(blob).hexdigest(),
        }
    )
    return result


if __name__ == "__main__":
    execute(lambda request: read_save(Path(request["save"]).resolve()))
