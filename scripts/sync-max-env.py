#!/usr/bin/env python3
"""Merge a bounded MAX configuration JSON object from stdin into the server .env."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


ALLOWED_NAMES = frozenset({
    "MAX_BOT_TOKEN", "MAX_BOT_USERNAME", "MAX_WEBHOOK_SECRET", "RESTAURANT_ADMIN_IDS",
})
MAX_PAYLOAD_BYTES = 32768
MAX_ENV_BYTES = 1024 * 1024
ASSIGNMENT = re.compile(r"^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)")


class ConfigError(Exception):
    """A safe, non-payload-bearing validation failure."""


def unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ConfigError("Duplicate JSON field")
        result[name] = value
    return result


def parse_updates(payload):
    if len(payload) > MAX_PAYLOAD_BYTES:
        raise ConfigError("Configuration payload is too large")
    try:
        values = json.loads(payload.decode("utf-8"), object_pairs_hook=unique_object)
    except (UnicodeError, ValueError, RecursionError):
        raise ConfigError("Invalid configuration JSON") from None
    if not isinstance(values, dict) or set(values) - ALLOWED_NAMES:
        raise ConfigError("Unsupported configuration fields")
    updates = {}
    for name, value in values.items():
        if not isinstance(value, str) or len(value) > 4096:
            raise ConfigError("Invalid configuration value")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ConfigError("Control characters are not permitted")
        if not value.strip():
            continue
        if name == "MAX_BOT_TOKEN":
            valid = re.fullmatch(r"[A-Za-z0-9._~+/=:-]{1,4096}", value)
        elif name == "MAX_BOT_USERNAME":
            valid = re.fullmatch(r"@?[A-Za-z0-9_]{1,64}", value)
        elif name == "MAX_WEBHOOK_SECRET":
            valid = re.fullmatch(r"[A-Za-z0-9_-]{5,256}", value)
        else:
            identifiers = [part.strip() for part in value.split(",")]
            valid = len(identifiers) <= 100 and all(
                re.fullmatch(r"[1-9][0-9]{0,19}", identifier) for identifier in identifiers
            )
            value = ",".join(identifiers)
        if not valid:
            raise ConfigError("Invalid configuration value")
        updates[name] = value
    return updates


def quote_closes(value, quote):
    escaped = False
    for character in value:
        if escaped:
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == quote:
            return True
    return False


def merge_text(existing, updates):
    """Preserve unrelated lines, including multiline quoted dotenv values."""
    result = []
    written = set()
    lines = existing.splitlines(keepends=True)
    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        match = ASSIGNMENT.match(line)
        block = [line]
        if match:
            name, value = match.groups()
            if value and value[0] in {"'", '"'} and not quote_closes(value[1:], value[0]):
                quote = value[0]
                while index < len(lines):
                    continuation = lines[index]
                    index += 1
                    block.append(continuation)
                    if quote_closes(continuation, quote):
                        break
                else:
                    raise ConfigError("Unterminated quoted configuration value")
            if name in updates:
                if name not in written:
                    newline = "\r\n" if line.endswith("\r\n") else "\n"
                    result.append(f"{name}={updates[name]}{newline}")
                    written.add(name)
                continue
        result.extend(block)
    for name in sorted(set(updates) - written):
        if result and not result[-1].endswith(("\n", "\r")):
            result.append("\n")
        result.append(f"{name}={updates[name]}\n")
    return "".join(result)


def sync_file(path, updates):
    path = Path(path)
    if path.is_symlink():
        raise ConfigError("Configuration must be a regular file")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as source:
        original_stat = os.fstat(source.fileno())
        if not stat.S_ISREG(original_stat.st_mode):
            raise ConfigError("Configuration must be a regular file")
        original = source.read(MAX_ENV_BYTES + 1)
    if len(original) > MAX_ENV_BYTES:
        raise ConfigError("Existing configuration is too large")
    try:
        rendered = merge_text(original.decode("utf-8"), updates).encode("utf-8")
    except UnicodeError:
        raise ConfigError("Invalid configuration encoding") from None
    if rendered == original and stat.S_IMODE(original_stat.st_mode) == 0o600:
        return False
    descriptor, temporary_name = tempfile.mkstemp(prefix=".env.max-sync-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            temporary_stat = os.fstat(target.fileno())
            if (temporary_stat.st_uid, temporary_stat.st_gid) != (original_stat.st_uid, original_stat.st_gid):
                os.fchown(target.fileno(), original_stat.st_uid, original_stat.st_gid)
            os.fchmod(target.fileno(), 0o600)
            target.write(rendered)
            target.flush()
            os.fsync(target.fileno())
        current_stat = path.lstat()
        for attribute in ("st_dev", "st_ino", "st_size", "st_mtime_ns"):
            if getattr(current_stat, attribute) != getattr(original_stat, attribute):
                raise ConfigError("Configuration changed during synchronization")
        os.replace(temporary_name, path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=Path("/srv/banquet/.env"))
    arguments = parser.parse_args()
    try:
        updates = parse_updates(sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1))
        changed = sync_file(arguments.path, updates)
    except (ConfigError, OSError):
        # Exception messages and tracebacks can contain file contents or payloads.
        print("MAX configuration sync failed; check payload format and file permissions.", file=sys.stderr)
        return 1
    print("MAX configuration synced." if changed else "MAX configuration unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
