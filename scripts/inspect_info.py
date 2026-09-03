#!/usr/bin/env python3
"""Summarize managed/hushpot/compiler/contract-info.json (structure explorer)."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "managed/hushpot/compiler/contract-info.json"
d = json.load(open(path, encoding="utf-8"))


def walk(obj, prefix="", depth=0):
    if depth > 3:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                print(f"{prefix}{k}: {type(v).__name__}({len(v)})")
                walk(v, prefix + "  ", depth + 1)
            else:
                s = str(v)
                print(f"{prefix}{k} = {s[:80]}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:4]):
            print(f"{prefix}[{i}]")
            walk(v, prefix + "  ", depth + 1)
        if len(obj) > 4:
            print(f"{prefix}... ({len(obj)} items total)")


walk(d)
