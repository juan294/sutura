"""Validate one bounded ATIF trajectory with the pinned NVIDIA model."""

from pathlib import Path
import sys

from nat.atif.trajectory import Trajectory

MAX_ATIF_BYTES = 5 * 1024 * 1024


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: validate-atif.py FILE")
    trajectory_path = Path(sys.argv[1])
    if not trajectory_path.is_file():
        raise SystemExit("ATIF input must be a regular file")
    if trajectory_path.stat().st_size > MAX_ATIF_BYTES:
        raise SystemExit(f"ATIF input exceeds {MAX_ATIF_BYTES} bytes")
    payload = trajectory_path.read_bytes()
    if len(payload) > MAX_ATIF_BYTES:
        raise SystemExit(f"ATIF input exceeds {MAX_ATIF_BYTES} bytes")
    trajectory = Trajectory.model_validate_json(payload)
    print(f"validated {trajectory.schema_version} trajectory {trajectory.trajectory_id or trajectory.session_id or '(anonymous)'}")


if __name__ == "__main__":
    main()
