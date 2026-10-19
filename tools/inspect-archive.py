"""Read a pinned ZIP's actual identity, dependency declarations and inventory."""

import hashlib
import json
from pathlib import Path
import zipfile
from tools.helper_protocol import execute, reject_constant


def inspect(request):
    path = Path(request["archive"])
    if not path.is_file() or path.stat().st_size > 256 * 1024 * 1024:
        raise RuntimeError("Archive exceeds the 256 MiB input limit or is not a file")
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != request["sha256"]:
        raise RuntimeError("Archive differs from the requested checksum")
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if (
            len(entries) > 10000
            or sum(item.file_size for item in entries) > 512 * 1024 * 1024
        ):
            raise RuntimeError("Archive exceeds entry or expanded-size limits")
        names = [item.filename for item in entries]
        if len(names) != len(set(names)) or any(len(name) > 1024 for name in names):
            raise RuntimeError("Archive has duplicate or overlong member names")
        metadata_entries = [
            item
            for item in entries
            if len(item.filename.split("/")) == 2
            and item.filename.endswith("/info.json")
        ]
        if len(metadata_entries) != 1 or metadata_entries[0].file_size > 1024 * 1024:
            raise RuntimeError("Archive requires exactly one bounded root info.json")
        metadata = json.loads(
            archive.read(metadata_entries[0]), parse_constant=reject_constant
        )
        prefix = f"{metadata['name']}_{metadata['version']}/"
        if metadata_entries[0].filename != prefix + "info.json" or any(
            not name.startswith(prefix) for name in names
        ):
            raise RuntimeError("Archive root does not match its declared identity")
        members = []
        for item in entries:
            name = item.filename[len(prefix) :]
            checked_name = name[:-1] if item.is_dir() else name
            if checked_name and (
                any(part in ("", ".", "..") for part in checked_name.split("/"))
                or "\\" in checked_name
            ):
                raise RuntimeError("Unsafe archive member")
            if (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError("Symbolic-link archive member")
            if not item.is_dir():
                if not checked_name:
                    raise RuntimeError("Empty archive member")
                members.append(name)
        if archive.testzip() is not None:
            raise RuntimeError("Archive CRC validation failed")
        # Factorio's documented default for an omitted dependencies field is base.
        dependencies = (
            metadata["dependencies"] if "dependencies" in metadata else ["base"]
        )
    return {
        "schema": 1,
        "archive": str(path),
        "sha256": digest,
        "mod": {"name": metadata["name"], "version": metadata["version"]},
        **(
            {"factorio_version": metadata["factorio_version"]}
            if "factorio_version" in metadata
            else {}
        ),
        "dependencies": dependencies,
        "members": sorted(members),
    }


if __name__ == "__main__":
    execute(inspect)
