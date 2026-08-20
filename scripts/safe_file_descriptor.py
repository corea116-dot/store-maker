import base64
import binascii
import os
import stat
import sys

O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
O_NOFOLLOW = 0x20000000 if sys.platform == "darwin" else getattr(os, "O_NOFOLLOW", 0)
READ_DIRECTORY_FLAGS = os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW
READ_FILE_FLAGS = os.O_RDONLY | O_NOFOLLOW
WRITE_FILE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | O_NOFOLLOW


class SafeFileError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def absolute_path(value) -> str:
    if not isinstance(value, str) or not value.startswith(os.sep) or "\x00" in value:
        raise SafeFileError("INVALID_PATH")
    if any(part in {".", ".."} for part in value.split(os.sep)):
        raise SafeFileError("INVALID_PATH")
    if sys.platform == "darwin" and (value == "/tmp" or value.startswith("/tmp/")):
        value = f"/private{value}"
    if sys.platform == "darwin" and (value == "/var" or value.startswith("/var/")):
        value = f"/private{value}"
    return os.path.normpath(value)


def file_mode(value, default: int) -> int:
    mode = default if value is None else value
    if not isinstance(mode, int) or mode < 0 or mode > 0o777:
        raise SafeFileError("INVALID_MODE")
    return mode


def path_parts(root: str, candidate: str, allow_root: bool = False) -> list[str]:
    try:
        if os.path.commonpath([root, candidate]) != root:
            raise SafeFileError("OUTSIDE_BOUNDARY")
    except ValueError:
        raise SafeFileError("OUTSIDE_BOUNDARY") from None
    relative = os.path.relpath(candidate, root)
    if relative == ".":
        if allow_root:
            return []
        raise SafeFileError("OUTSIDE_BOUNDARY")
    parts = relative.split(os.sep)
    if any(not part or part in {".", ".."} for part in parts):
        raise SafeFileError("INVALID_PATH")
    return parts


def private_directory(fd: int) -> None:
    metadata = os.fstat(fd)
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o022:
        raise SafeFileError("UNSAFE_DIRECTORY")


def open_absolute_directory(path: str) -> int:
    current = os.open(os.sep, READ_DIRECTORY_FLAGS)
    try:
        for component in path_parts(os.sep, path, allow_root=True):
            child = os.open(component, READ_DIRECTORY_FLAGS, dir_fd=current)
            os.close(current)
            current = child
        return current
    except (OSError, SafeFileError):
        os.close(current)
        raise


def open_child_directory(parent: int, name: str, create: bool, mode: int) -> int:
    try:
        child = os.open(name, READ_DIRECTORY_FLAGS, dir_fd=parent)
    except FileNotFoundError:
        if not create:
            raise
        try:
            os.mkdir(name, mode, dir_fd=parent)
        except FileExistsError:
            pass
        child = os.open(name, READ_DIRECTORY_FLAGS, dir_fd=parent)
    private_directory(child)
    return child


def open_root(payload, create: bool) -> tuple[str, int]:
    trusted_root = absolute_path(payload.get("trustedRoot"))
    root = absolute_path(payload.get("root"))
    current = open_absolute_directory(trusted_root)
    try:
        mode = file_mode(payload.get("directoryMode"), 0o700)
        for component in path_parts(trusted_root, root, allow_root=True):
            child = open_child_directory(current, component, create, mode)
            os.close(current)
            current = child
        private_directory(current)
        return root, current
    except (OSError, SafeFileError):
        os.close(current)
        raise


def parent_and_name(root_fd: int, root: str, candidate, create: bool, mode: int) -> tuple[int, str]:
    parts = path_parts(root, absolute_path(candidate))
    parent = os.dup(root_fd)
    try:
        for component in parts[:-1]:
            child = open_child_directory(parent, component, create, mode)
            os.close(parent)
            parent = child
        return parent, parts[-1]
    except (OSError, SafeFileError):
        os.close(parent)
        raise


def open_regular(root_fd: int, root: str, candidate) -> tuple[int, int]:
    parent, name = parent_and_name(root_fd, root, candidate, False, 0o700)
    try:
        file_fd = os.open(name, READ_FILE_FLAGS, dir_fd=parent)
    finally:
        os.close(parent)
    metadata = os.fstat(file_fd)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        os.close(file_fd)
        raise SafeFileError("UNSAFE_FILE")
    return file_fd, metadata.st_size


def payload_bytes(payload) -> bytes:
    value = payload.get("data")
    if not isinstance(value, str):
        raise SafeFileError("INVALID_DATA")
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise SafeFileError("INVALID_DATA") from None


def write_bytes(fd: int, content: bytes) -> None:
    offset = 0
    while offset < len(content):
        offset += os.write(fd, content[offset:])


def delete_entry(parent: int, name: str, recursive: bool) -> None:
    try:
        directory = os.open(name, READ_DIRECTORY_FLAGS, dir_fd=parent)
    except NotADirectoryError:
        metadata = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISREG(metadata.st_mode):
            raise SafeFileError("UNSAFE_FILE")
        os.unlink(name, dir_fd=parent)
        return
    try:
        private_directory(directory)
        if not recursive:
            raise SafeFileError("UNSAFE_FILE")
        for child in os.listdir(directory):
            delete_entry(directory, child, True)
    finally:
        os.close(directory)
    os.rmdir(name, dir_fd=parent)
