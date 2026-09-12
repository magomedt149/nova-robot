import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "assets" / "model" / "wolf.glb"
REFS = {
    "idle": ROOT / "motion_refs" / "idle.mp4",
    "walk": ROOT / "motion_refs" / "walk.mp4",
    "run": ROOT / "motion_refs" / "run.mp4",
    "howl": ROOT / "motion_refs" / "howl.mp4",
}
REPORT = ROOT / "exports" / "asset_preflight_report.json"
REPORT.parent.mkdir(parents=True, exist_ok=True)

present = {"wolf.glb": MODEL.exists()}
for name, path in REFS.items():
    present[f"{name}.mp4"] = path.exists()

missing = [name for name, ok in present.items() if not ok]
if not MODEL.exists():
    status = "WAITING_FOR_WOLF_GLB"
elif missing:
    status = "WAITING_FOR_MOTION_REFS"
else:
    status = "READY_FOR_REAL_WOLF_PIPELINE"

report = {
    "status": status,
    "model": str(MODEL.relative_to(ROOT)),
    "motion_refs": {k: str(v.relative_to(ROOT)) for k, v in REFS.items()},
    "present": present,
    "missing": missing,
    "fps": 24,
    "timings_seconds": {"idle": 3.0, "walk": 2.0, "run": 1.0, "howl": 3.5},
    "free_first": True,
    "paid_api_calls": 0,
}
REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))

out = os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out, "a", encoding="utf-8") as f:
        f.write(f"model_present={'true' if MODEL.exists() else 'false'}\n")
        f.write(f"all_assets_ready={'true' if not missing else 'false'}\n")
        f.write(f"status={status}\n")
