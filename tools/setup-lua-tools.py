"""Build owned Lua tools from supplied, checksum-pinned local archives only."""

import hashlib
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tarfile

from tools.helper_protocol import execute


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def checked_archive(pin):
    path = Path(pin["path"])
    if (
        not path.is_file()
        or path.stat().st_size > pin["maxBytes"]
        or sha256(path) != pin["sha256"]
    ):
        raise RuntimeError(f"Supplied archive differs from its pin: {path.name}")
    return path


def prepare(request):
    cache = Path(request["cache"])
    if cache.resolve() != cache or any(cache.iterdir()):
        raise RuntimeError("Build requires a canonical, empty owned cache directory")
    for name, pin in request["sources"].items():
        with tarfile.open(checked_archive(pin)) as package:
            members = package.getmembers()
            if sum(member.size for member in members) > 128 * 1024 * 1024:
                raise RuntimeError("Lua source archive exceeds its extraction limit")
            for member in members:
                target = (cache / member.name).resolve()
                if not target.is_relative_to(cache / name) or not (
                    member.isfile() or member.isdir()
                ):
                    raise RuntimeError(f"Unsafe archive member: {member.name}")
            package.extractall(cache, filter="data")
    found = shutil.which("lua")
    if found is None:
        raise RuntimeError("Run through mise: Lua 5.2.4 must be on PATH")
    lua = Path(found).resolve()
    version = subprocess.check_output(
        [str(lua), "-v"], stderr=subprocess.STDOUT, text=True, timeout=30
    )
    if not version.startswith("Lua 5.2.4"):
        raise RuntimeError(f"Expected Lua 5.2.4, got {version.strip()}")
    compiler = shutil.which(os.environ.get("CC", "cc"))
    if compiler is None:
        raise RuntimeError("Explicit tool setup requires a C compiler")
    compiler_version = subprocess.check_output(
        [compiler, "--version"], text=True, timeout=30
    ).strip()
    flags = (
        ["-bundle", "-undefined", "dynamic_lookup"]
        if platform.system() == "Darwin"
        else ["-shared", "-fPIC"]
    )
    subprocess.run(
        [
            compiler,
            "-O2",
            *flags,
            "-I" + str(lua.parent.parent / "include"),
            str(cache / "luafilesystem-1_8_0/src/lfs.c"),
            "-o",
            str(cache / "lfs.so"),
        ],
        check=True,
        timeout=120,
    )
    with tarfile.open(checked_archive(request["emmy"])) as package:
        matches = [
            member
            for member in package.getmembers()
            if member.name.lstrip("./") == "emmylua_check" and member.isfile()
        ]
        if len(matches) != 1 or matches[0].size > 128 * 1024 * 1024:
            raise RuntimeError("EmmyLua archive has no unique bounded executable")
        source = package.extractfile(matches[0])
        if source is None:
            raise RuntimeError("EmmyLua archive contains no readable executable")
        with source, (cache / "emmylua_check").open("xb") as output:
            shutil.copyfileobj(source, output)
    (cache / "emmylua_check").chmod(0o755)
    files = {}
    for path in sorted(cache.rglob("*")):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise RuntimeError("Built cache contains an unsupported file type")
        if path.is_file():
            files[path.relative_to(cache).as_posix()] = sha256(path)
    return {
        "schema": 2,
        "cache": str(cache),
        "inputSha256": request["inputSha256"],
        "luacheck": "1.2.0",
        "emmy": "0.25.1",
        "lua": "5.2.4",
        "build": {"compiler": compiler_version, "luaExecutableSha256": sha256(lua)},
        "files": files,
    }


if __name__ == "__main__":
    execute(prepare)
