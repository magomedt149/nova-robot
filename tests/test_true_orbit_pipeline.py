#!/usr/bin/env python3
"""Fast stdlib checks for NOVA true-orbit planning. No Blender install required."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("nova_pipeline", ROOT / "automation" / "nova_pipeline.py")
mod = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(mod)


def test_full_orbit():
    pack = mod.parse_prompt(
        "Toyota Supra on rooftop, camera makes a full 360 orbit around the car, 5 sec, 9:16",
        5,
        "9:16",
    )
    assert pack["subject_type"] == "car"
    assert pack["camera"] == "orbit360"
    path = pack["blocking"]["camera_path"]
    assert path["type"] == "circle"
    assert path["degrees"] == 360.0
    assert len(pack["shots"]) == 1
    script = mod.blender_script(pack)
    assert "primitive_bezier_circle_add" in script
    assert "FOLLOW_PATH" in script
    assert "TRACK_TO" in script
    assert "offset_factor" in script
    assert "LINEAR" in script
    assert "PROXY_CAR_BODY" in script


def test_half_orbit_default():
    pack = mod.parse_prompt("camera orbit around the object, no cuts", 5, "16:9")
    assert pack["camera"] == "orbit"
    assert pack["blocking"]["camera_path"]["degrees"] == 180.0


def test_non_orbit_stays_linear():
    pack = mod.parse_prompt("slow push-in to a person", 5, "16:9")
    assert pack["camera"] == "push"
    assert pack["blocking"]["camera_path"]["type"] == "linear"


if __name__ == "__main__":
    test_full_orbit()
    test_half_orbit_default()
    test_non_orbit_stays_linear()
    print("OK: NOVA true orbit planning tests passed")
