# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
import errno
import json
import sys

from safe_file_descriptor import SafeFileError
from safe_file_operations import OPERATIONS, PROTOCOL_VERSION


def read_payload():
    try:
        value = json.loads(sys.stdin.buffer.readline().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise SafeFileError("INVALID_PROTOCOL") from None
    if not isinstance(value, dict) or value.get("version") != PROTOCOL_VERSION:
        raise SafeFileError("INVALID_PROTOCOL")
    return value


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in OPERATIONS:
        raise SafeFileError("INVALID_OPERATION")
    OPERATIONS[sys.argv[1]](read_payload())
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SafeFileError as error:
        sys.stderr.write(f"SAFE_FILE_ERROR:{error.code}\n")
        raise SystemExit(2)
    except OSError as error:
        code = "EEXIST" if error.errno == errno.EEXIST else "FILESYSTEM"
        sys.stderr.write(f"SAFE_FILE_ERROR:{code}\n")
        raise SystemExit(2)
