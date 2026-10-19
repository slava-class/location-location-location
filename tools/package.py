"""Deterministic ZIP algorithm; orchestration and contracts live in Bun/Effect."""

from pathlib import Path
import hashlib
import json
import platform
import zipfile
import zlib
from tools.helper_protocol import execute


def package(request):
    root = Path(request["modRoot"]).resolve(strict=True)
    output_directory = Path(request["outputDirectory"]).resolve(strict=True)
    if output_directory.is_relative_to(root):
        raise RuntimeError("Package output must not modify the source tree")
    metadata = json.loads((root / "info.json").read_text())
    info = request["info"]
    if any(metadata.get(key) != value for key, value in info.items()):
        raise RuntimeError("Source metadata changed after project resolution")
    names = sorted(request["members"])
    if not names or len(set(names)) != len(names) or "info.json" not in names:
        raise RuntimeError("Package inventory must be unique and contain info.json")
    files = []
    for name in names:
        path = root / name
        if any(
            parent.is_symlink()
            for parent in [path, *path.parents]
            if parent.is_relative_to(root)
        ):
            raise RuntimeError(f"Symlink in release member: {name}")
        if not path.resolve(strict=True).is_relative_to(root) or not path.is_file():
            raise RuntimeError(
                f"Release member escapes the mod or is not a file: {name}"
            )
        files.append((name, path))
    prefix = f"{info['name']}_{info['version']}"
    output = output_directory / f"{prefix}.zip"
    temporary = output.with_suffix(".zip.part")
    if output.exists():
        raise RuntimeError("Refusing to replace an existing package")
    hashes = {}
    with zipfile.ZipFile(
        temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for name, path in files:
            data = path.read_bytes()
            member = zipfile.ZipInfo(prefix + "/" + name, (1980, 1, 1, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            archive.writestr(member, data, compresslevel=9)
            hashes[name] = hashlib.sha256(data).hexdigest()
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != len(files):
            raise RuntimeError("ZIP integrity check failed")
        for name, path in files:
            data = path.read_bytes()
            if (
                archive.read(prefix + "/" + name) != data
                or hashlib.sha256(data).hexdigest() != hashes[name]
            ):
                raise RuntimeError(f"Packaged bytes differ or source changed: {name}")
        if json.loads(archive.read(prefix + "/info.json")) != metadata:
            raise RuntimeError("Packaged metadata differs")
    temporary.rename(output)
    data = output.read_bytes()
    return {
        "schema": 1,
        "mod": {"name": info["name"], "version": info["version"]},
        "archive": str(output),
        "sha256": hashlib.sha256(data).hexdigest(),
        "sha1": hashlib.sha1(data).hexdigest(),
        "files": hashes,
        "compression": {
            "implementation": "python-zipfile",
            "python": platform.python_version(),
            "zlib": zlib.ZLIB_RUNTIME_VERSION,
            "method": "deflate",
            "level": 9,
        },
    }


if __name__ == "__main__":
    execute(package)
