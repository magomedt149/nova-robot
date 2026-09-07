#!/usr/bin/env python3
"""Run NOVA's dependency-free regression tests without pytest."""
from __future__ import annotations

import importlib.util
import inspect
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST_DIR = ROOT / "tests"


def load_module(path: Path):
    name = f"nova_{path.stem}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    failures: list[str] = []
    passed = 0
    paths = sorted(TEST_DIR.glob("test_*.py"))
    if not paths:
        print("ERROR: no regression tests found")
        return 1

    for path in paths:
        try:
            module = load_module(path)
            functions = [
                (name, fn)
                for name, fn in inspect.getmembers(module, inspect.isfunction)
                if name.startswith("test_") and fn.__module__ == module.__name__
            ]
            if functions:
                for name, function in functions:
                    if inspect.signature(function).parameters:
                        raise RuntimeError(f"{path.name}:{name} requires unsupported fixtures")
                    function()
                    passed += 1
                    print(f"PASS {path.name}:{name}")
            elif callable(getattr(module, "main", None)):
                module.main()
                passed += 1
                print(f"PASS {path.name}:main")
            else:
                raise RuntimeError("no test_* functions or main()")
        except Exception:
            failures.append(path.name)
            print(f"FAIL {path.name}")
            traceback.print_exc()

    print(f"RESULT: {passed} passed, {len(failures)} failed")
    if failures:
        print("FAILED FILES: " + ", ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

