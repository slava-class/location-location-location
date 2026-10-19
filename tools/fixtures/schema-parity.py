"""Behavioral fixture for the generated Effect/Python wire contract."""

import json
from jsonschema import Draft202012Validator

from tools.helper_protocol import execute, reject_constant


def check(request):
    Draft202012Validator.check_schema(request["validator"])
    validator = Draft202012Validator(request["validator"])
    results = []
    for case in request["cases"]:
        try:
            value = json.loads(case["json"], parse_constant=reject_constant)
            accepted = validator.is_valid(value)
        except ValueError:
            accepted = False
        results.append({"id": case["id"], "accepted": accepted})
    return {"schema": 1, "results": results}


execute(check)
