from __future__ import annotations

import json
import os
import sys
import uuid

from safe_file_descriptor import (
    O_DIRECTORY,
    O_NOFOLLOW,
    WRITE_FILE_FLAGS,
    SafeFileError,
    delete_entry,
    file_mode,
    open_regular,
    open_root,
    parent_and_name,
    payload_bytes,
    write_bytes,
)

PROTOCOL_VERSION = 1


def control(event: str, size: int | None = None) -> None:
    message = {"event": event}
    if size is not None:
        message["size"] = size
    os.write(3, json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n")


def await_continue() -> None:
    if sys.stdin.buffer.read(1) != b"C":
        raise SafeFileError("ABORTED")


def ready_after_root() -> None:
    control("root-opened")
    await_continue()


def output_json(value) -> None:
    sys.stdout.write(json.dumps(value, separators=(",", ":")))
    sys.stdout.flush()


def write_new(payload) -> None:
    root, root_fd = open_root(payload, create=True)
    try:
        ready_after_root()
        parent, name = parent_and_name(root_fd, root, payload.get("candidate"), True, file_mode(payload.get("directoryMode"), 0o700))
        try:
            file_fd = os.open(name, WRITE_FILE_FLAGS, file_mode(payload.get("fileMode"), 0o600), dir_fd=parent)
            try:
                write_bytes(file_fd, payload_bytes(payload))
                os.fsync(file_fd)
            except (OSError, SafeFileError):
                os.close(file_fd)
                os.unlink(name, dir_fd=parent)
                raise
            os.close(file_fd)
        finally:
            os.close(parent)
        output_json({"ok": True})
    finally:
        os.close(root_fd)


def immutable_link(parent: int, temporary: str, target: str) -> None:
    try:
        os.link(temporary, target, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
    except FileExistsError:
        raise SafeFileError("EEXIST") from None
    except (NotImplementedError, TypeError):
        raise SafeFileError("UNSUPPORTED_LINK") from None


def write_immutable(payload) -> None:
    root, root_fd = open_root(payload, create=True)
    temporary = None
    try:
        ready_after_root()
        parent, name = parent_and_name(root_fd, root, payload.get("candidate"), True, file_mode(payload.get("directoryMode"), 0o700))
        try:
            temporary = f".{name}.{uuid.uuid4().hex}.tmp"
            file_fd = os.open(temporary, WRITE_FILE_FLAGS, file_mode(payload.get("fileMode"), 0o600), dir_fd=parent)
            try:
                write_bytes(file_fd, payload_bytes(payload))
                os.fsync(file_fd)
            finally:
                os.close(file_fd)
            immutable_link(parent, temporary, name)
            os.unlink(temporary, dir_fd=parent)
            temporary = None
            os.fsync(parent)
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError:
                    pass
            os.close(parent)
        output_json({"ok": True})
    finally:
        os.close(root_fd)


def remove_path(payload) -> None:
    root, root_fd = open_root(payload, create=False)
    try:
        ready_after_root()
        parent, name = parent_and_name(root_fd, root, payload.get("candidate"), False, 0o700)
        try:
            try:
                delete_entry(parent, name, payload.get("recursive") is True)
            except FileNotFoundError:
                if payload.get("ignoreMissing") is not True:
                    raise
        finally:
            os.close(parent)
        output_json({"ok": True})
    finally:
        os.close(root_fd)


def inspect(payload) -> None:
    root, root_fd = open_root(payload, create=False)
    try:
        ready_after_root()
        file_fd, size = open_regular(root_fd, root, payload.get("candidate"))
        os.close(file_fd)
        output_json({"size": size})
    finally:
        os.close(root_fd)


def open_read(payload) -> None:
    root, root_fd = open_root(payload, create=False)
    file_fd = None
    try:
        ready_after_root()
        file_fd, size = open_regular(root_fd, root, payload.get("candidate"))
        control("file-opened", size)
        await_continue()
        while True:
            chunk = os.read(file_fd, 64 * 1024)
            if not chunk:
                break
            write_bytes(sys.stdout.fileno(), chunk)
    finally:
        if file_fd is not None:
            os.close(file_fd)
        os.close(root_fd)


def ensure_directory(payload) -> None:
    _root, root_fd = open_root(payload, create=True)
    try:
        ready_after_root()
        output_json({"ok": True})
    finally:
        os.close(root_fd)


def probe(_payload) -> None:
    required = [os.open, os.mkdir, os.unlink, os.rmdir, os.link]
    if not O_NOFOLLOW or not O_DIRECTORY or not all(operation in os.supports_dir_fd for operation in required):
        raise SafeFileError("UNSUPPORTED_RUNTIME")
    output_json({"protocol": PROTOCOL_VERSION})


OPERATIONS = {
    "probe": probe,
    "ensure-directory": ensure_directory,
    "inspect": inspect,
    "open-read": open_read,
    "remove-path": remove_path,
    "write-immutable": write_immutable,
    "write-new": write_new,
}
