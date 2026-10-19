"""Internal helper protocol. Schemas are emitted by the canonical Effect contracts."""

import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator


def reject_constant(_value):
    raise ValueError("Non-finite values are not JSON")


def read_json(path):
    path = Path(path)
    if path.stat().st_size > 4 * 1024 * 1024:
        raise RuntimeError("Helper input exceeds the protocol size limit")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)


def execute(operation):
    if len(sys.argv) != 4:
        raise RuntimeError(
            "Internal helper requires contract, request and result paths"
        )
    contract_path, request_path, result_path = map(Path, sys.argv[1:])
    contract = read_json(contract_path)
    request_validator = Draft202012Validator(contract["request"])
    result_validator = Draft202012Validator(contract["result"])
    Draft202012Validator.check_schema(contract["request"])
    Draft202012Validator.check_schema(contract["result"])
    request = read_json(request_path)
    if not request_validator.is_valid(request):
        raise RuntimeError("Helper request does not satisfy its generated schema")
    result = operation(request)
    if not result_validator.is_valid(result):
        raise RuntimeError("Helper result does not satisfy its generated schema")
    temporary = result_path.with_name(result_path.name + ".part")
    with temporary.open("x") as output:
        json.dump(result, output, sort_keys=True, indent=2, allow_nan=False)
        output.write("\n")
    temporary.replace(result_path)
