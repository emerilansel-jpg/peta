#!/usr/bin/env python3
"""
OneDrive Sync via Microsoft Graph API

Features:
- OAuth 2.0 auth-code flow (first run opens browser, then refresh-token runs headless)
- Sync local folder to OneDrive personal while preserving folder structure
- Auto-upload new/changed files, skip unchanged
- Large-file upload session support (>4MB)
- Exclude patterns: hardcoded defaults + .syncignore file + CLI --exclude
- The script itself (onedrive_sync.py) and credential files are NEVER uploaded

Usage:
  python onedrive_sync.py --auth                # Authenticate and save tokens
  python onedrive_sync.py --sync . backup/docs  # Sync current folder to OneDrive /backup/docs
  python onedrive_sync.py --sync . backup/docs --dry-run
  python onedrive_sync.py --sync . backup/docs --delete-remote  # also delete remote files removed locally
  python onedrive_sync.py --sync . backup/docs --exclude "*.tmp" --exclude "node_modules/"

Requires:
  pip install requests python-dotenv
"""

import os
import sys
import json
import time
import hashlib
import argparse
import logging
import webbrowser
import http.server
import socketserver
import fnmatch
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from threading import Thread

import requests
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CLIENT_ID = os.getenv("ONEDRIVE_CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("ONEDRIVE_CLIENT_SECRET", "").strip()
TENANT = os.getenv("ONEDRIVE_TENANT", "common").strip() or "common"
REDIRECT_URI = os.getenv("ONEDRIVE_REDIRECT_URI", "http://localhost:8080").strip()
TOKEN_PATH = os.getenv("ONEDRIVE_TOKEN_PATH", "tokens.json").strip()
SCOPES = "Files.ReadWrite offline_access"

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
AUTH_URL = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize"
TOKEN_URL = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"

UPLOAD_SIZE_THRESHOLD = 4 * 1024 * 1024  # 4 MB

# These paths are always excluded from sync, even if the source folder
# contains them. They protect the script, credentials, and sync metadata.
DEFAULT_EXCLUDE_PATTERNS = [
    # Script and its metadata
    "onedrive_sync.py",
    "onedrive_sync*.py",
    # Credentials and environment
    ".env",
    ".env.*",
    "tokens.json",
    "tokens*.json",
    # Sync configuration and docs
    ".syncignore",
    "README_onedrive_sync.md",
    "SETUP.md",
    # Logs
    "*.log",
    "sync.log",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("onedrive")


# ---------------------------------------------------------------------------
# Exclude helpers
# ---------------------------------------------------------------------------

def _pattern_to_regex(pattern: str) -> str:
    """Convert a glob/fnmatch pattern with optional trailing-dir slash to regex."""
    # trailing slash means "directory"
    pattern = pattern.rstrip("/")
    regex = fnmatch.translate(pattern)
    return regex.rstrip("$")  # we will match anywhere in the path


def _compile_excludes(patterns):
    """Compile a list of patterns into matching functions."""
    funcs = []
    for pat in patterns:
        if not pat or pat.startswith("#"):
            continue
        regex = _pattern_to_regex(pat)
        try:
            compiled = re.compile(regex, re.IGNORECASE)
        except re.error as exc:
            log.warning("Invalid exclude pattern %r: %s", pat, exc)
            continue
        funcs.append((pat, compiled))
    return funcs


def _load_syncignore(local_root: Path):
    """Load .syncignore from local_root if present."""
    path = local_root / ".syncignore"
    patterns = []
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    patterns.append(line)
        log.info("Loaded %d patterns from .syncignore", len(patterns))
    return patterns


def is_excluded(rel_path: str, exclude_funcs, is_dir: bool = False) -> bool:
    """Check whether rel_path (POSIX, relative to sync root) matches any exclude pattern.

    Supports:
    - Simple filename match (e.g. onedrive_sync.py)
    - Glob wildcards (e.g. *.tmp, *.log)
    - Directory matches (e.g. node_modules/ matches the dir and all contents)
    """
    rel_path = rel_path.lstrip("/")
    parts = rel_path.split("/")

    for pat, compiled in exclude_funcs:
        # Directory-specific pattern: if pattern ends with /, only match directories
        if pat.endswith("/"):
            if is_dir:
                # match any directory component exactly
                dir_name = pat.rstrip("/")
                if any(part == dir_name for part in parts):
                    return True
            continue

        # Match against full relative path
        if compiled.search(rel_path):
            return True
        # Match against each path component (so '*.py' matches at any depth)
        if any(compiled.match(part) for part in parts):
            return True

    return False


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def load_tokens():
    if not os.path.exists(TOKEN_PATH):
        return None
    with open(TOKEN_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_tokens(tokens):
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        json.dump(tokens, f, indent=2)
    log.info("Tokens saved to %s", TOKEN_PATH)


def get_access_token():
    tokens = load_tokens()
    if not tokens:
        log.error("No tokens found. Run: python onedrive_sync.py --auth")
        sys.exit(1)

    expires_at = tokens.get("expires_at", 0)
    if time.time() >= expires_at - 60:
        log.info("Access token expired; refreshing...")
        resp = requests.post(
            TOKEN_URL,
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "refresh_token": tokens["refresh_token"],
                "grant_type": "refresh_token",
                "scope": SCOPES,
            },
            timeout=30,
        )
        if resp.status_code != 200:
            log.error("Refresh failed: %s %s", resp.status_code, resp.text)
            sys.exit(1)
        data = resp.json()
        tokens["access_token"] = data["access_token"]
        if "refresh_token" in data:
            tokens["refresh_token"] = data["refresh_token"]
        tokens["expires_at"] = time.time() + data.get("expires_in", 3600)
        save_tokens(tokens)

    return tokens["access_token"]


# ---------------------------------------------------------------------------
# Auth flow
# ---------------------------------------------------------------------------

def run_auth_server(auth_code_event):
    """Tiny HTTP server to catch the OAuth redirect."""

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/":
                qs = parse_qs(parsed.query)
                code = qs.get("code", [None])[0]
                error = qs.get("error", [None])[0]
                if code:
                    auth_code_event["code"] = code
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"Authentication successful. You can close this tab.")
                    return
                if error:
                    auth_code_event["error"] = error
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(f"Error: {error}".encode())
                    return
            self.send_response(404)
            self.end_headers()

        def log_message(self, format, *args):
            pass

    port = urlparse(REDIRECT_URI).port or 8080
    with socketserver.TCPServer(("", port), Handler) as httpd:
        httpd.timeout = 1
        while "code" not in auth_code_event and "error" not in auth_code_event:
            httpd.handle_request()


def authenticate():
    if not CLIENT_ID or not CLIENT_SECRET:
        log.error("Set ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET in .env")
        sys.exit(1)

    auth_code_event = {}
    server_thread = Thread(target=run_auth_server, args=(auth_code_event,))
    server_thread.start()

    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "response_mode": "query",
    }
    auth_uri = f"{AUTH_URL}?{urlencode(params)}"
    log.info("Opening browser for authentication...")
    webbrowser.open(auth_uri)

    server_thread.join(timeout=120)
    if "code" not in auth_code_event:
        log.error("Did not receive authorization code within 120s.")
        sys.exit(1)

    code = auth_code_event["code"]
    resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
            "scope": SCOPES,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        log.error("Token exchange failed: %s %s", resp.status_code, resp.text)
        sys.exit(1)

    data = resp.json()
    tokens = {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "expires_at": time.time() + data.get("expires_in", 3600),
    }
    save_tokens(tokens)
    log.info("Authentication successful. You can now run --sync.")


# ---------------------------------------------------------------------------
# Graph API helpers
# ---------------------------------------------------------------------------

def graph_request(method, path, headers=None, **kwargs):
    token = get_access_token()
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    url = f"{GRAPH_BASE}{path}"
    resp = requests.request(method, url, headers=h, timeout=120, **kwargs)
    return resp


def _encode_path(remote_path: str) -> str:
    """Encode a OneDrive item path for the Graph URL segment."""
    return remote_path.strip("/").replace(" ", "%20")


def get_remote_children(remote_path: str):
    """List remote files in a folder. Returns dict of {name: item}."""
    if remote_path in ("", "/"):
        path = "/me/drive/root/children"
    else:
        enc = _encode_path(remote_path)
        path = f"/me/drive/root:/{enc}:/children"
    items = {}
    while path:
        resp = graph_request("GET", path)
        if resp.status_code != 200:
            log.error("List failed %s: %s %s", remote_path, resp.status_code, resp.text)
            break
        data = resp.json()
        for item in data.get("value", []):
            items[item["name"]] = item
        path = data.get("@odata.nextLink", "")
        if path:
            path = path.replace(GRAPH_BASE, "")
    return items


def get_remote_item(remote_path: str):
    """Get a single remote item by path. Returns None if not found."""
    enc = _encode_path(remote_path)
    resp = graph_request("GET", f"/me/drive/root:/{enc}")
    if resp.status_code == 200:
        return resp.json()
    if resp.status_code == 404:
        return None
    log.error("Get item failed %s: %s %s", remote_path, resp.status_code, resp.text)
    return None


def create_remote_folder(remote_path: str) -> bool:
    """Create a folder (and any missing parents) on OneDrive."""
    if remote_path in ("", "/"):
        return True

    parts = remote_path.strip("/").split("/")
    parent = "/me/drive/root/children"
    current_path = ""

    for part in parts:
        current_path = f"{current_path}/{part}".strip("/")
        existing = get_remote_item(current_path)
        if existing:
            if "folder" in existing:
                # reuse existing folder
                parent = f"/me/drive/items/{existing['id']}/children"
                continue
            else:
                log.error("Path exists but is not a folder: %s", current_path)
                return False

        resp = graph_request(
            "POST",
            parent,
            json={
                "name": part,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "fail",
            },
        )
        if resp.status_code == 201:
            item = resp.json()
            parent = f"/me/drive/items/{item['id']}/children"
        else:
            log.error("Create folder failed %s: %s %s", current_path, resp.status_code, resp.text)
            return False

    return True


def upload_small_file(local_path: Path, remote_path: str):
    enc = _encode_path(remote_path)
    with open(local_path, "rb") as f:
        content = f.read()
    resp = graph_request(
        "PUT",
        f"/me/drive/root:/{enc}:/content",
        headers={"Content-Type": "application/octet-stream"},
        data=content,
    )
    if resp.status_code in (200, 201):
        log.info("Uploaded (small) %s", remote_path)
        return True
    log.error("Upload failed %s: %s %s", remote_path, resp.status_code, resp.text)
    return False


def upload_large_file(local_path: Path, remote_path: str):
    enc = _encode_path(remote_path)
    resp = graph_request(
        "POST",
        f"/me/drive/root:/{enc}:/createUploadSession",
        json={"item": {"@microsoft.graph.conflictBehavior": "replace"}},
    )
    if resp.status_code not in (200, 201):
        log.error("Upload session failed %s: %s %s", remote_path, resp.status_code, resp.text)
        return False
    upload_url = resp.json().get("uploadUrl")
    if not upload_url:
        log.error("No uploadUrl returned")
        return False

    size = os.path.getsize(local_path)
    chunk_size = 10 * 1024 * 1024  # 10 MB
    with open(local_path, "rb") as f:
        start = 0
        while start < size:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            end = start + len(chunk) - 1
            headers = {
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {start}-{end}/{size}",
            }
            chunk_resp = requests.put(upload_url, headers=headers, data=chunk, timeout=120)
            if chunk_resp.status_code in (200, 201):
                log.info("Uploaded (large) %s", remote_path)
                return True
            if chunk_resp.status_code == 202:
                start += len(chunk)
                continue
            log.error("Chunk upload failed %s: %s %s", remote_path, chunk_resp.status_code, chunk_resp.text)
            return False
    return True


def upload_file(local_path: Path, remote_path: str):
    size = os.path.getsize(local_path)
    if size <= UPLOAD_SIZE_THRESHOLD:
        return upload_small_file(local_path, remote_path)
    return upload_large_file(local_path, remote_path)


def delete_remote_file(remote_path: str):
    enc = _encode_path(remote_path)
    resp = graph_request("DELETE", f"/me/drive/root:/{enc}")
    if resp.status_code in (204, 404):
        log.info("Deleted remote %s", remote_path)
        return True
    log.error("Delete failed %s: %s %s", remote_path, resp.status_code, resp.text)
    return False


# ---------------------------------------------------------------------------
# Sync logic
# ---------------------------------------------------------------------------

def local_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def remote_file_hash(item: dict) -> str:
    """Return SHA-256 hash if available from OneDrive, else empty string."""
    hashes = item.get("file", {}).get("hashes", {})
    # OneDrive personal usually returns sha256Hash
    return hashes.get("sha256Hash") or hashes.get("quickXorHash") or ""


def _ensure_remote_folder(remote_path: str, created_cache: dict) -> bool:
    """Ensure a remote folder exists, with a cache to avoid repeated API calls."""
    if remote_path in ("", "/"):
        return True
    if remote_path in created_cache:
        return True
    if create_remote_folder(remote_path):
        created_cache[remote_path] = True
        return True
    return False


def sync_folder(local_root: Path, remote_root: str, dry_run: bool = False,
                delete_remote: bool = False, extra_excludes=None):
    local_root = Path(local_root).resolve()
    if not local_root.exists():
        log.error("Local path does not exist: %s", local_root)
        return False

    # Build exclude matchers
    exclude_patterns = list(DEFAULT_EXCLUDE_PATTERNS)
    exclude_patterns.extend(_load_syncignore(local_root))
    if extra_excludes:
        exclude_patterns.extend(extra_excludes)
    exclude_funcs = _compile_excludes(exclude_patterns)

    log.info("Exclude patterns: %s", exclude_patterns)

    # Enumerate local files and dirs (respecting excludes)
    local_files = {}   # rel_path -> local Path
    local_dirs = set() # rel_path of directories we need on remote

    for dirpath, dirnames, filenames in os.walk(local_root):
        dirpath = Path(dirpath)
        rel_dir = dirpath.relative_to(local_root).as_posix()
        if rel_dir == ".":
            rel_dir = ""

        # Prune excluded directories so we never descend into them
        dirnames[:] = [
            d for d in dirnames
            if not is_excluded(
                f"{rel_dir}/{d}".strip("/"), exclude_funcs, is_dir=True
            )
        ]

        for d in dirnames:
            rel = f"{rel_dir}/{d}".strip("/")
            local_dirs.add(rel)

        for f in filenames:
            rel = f"{rel_dir}/{f}".strip("/")
            if not is_excluded(rel, exclude_funcs, is_dir=False):
                local_files[rel] = dirpath / f

    # Create remote folders upfront
    folder_cache = {}
    remote_root_stripped = remote_root.strip("/")
    for rel_dir in sorted(local_dirs):
        remote_dir = f"{remote_root_stripped}/{rel_dir}".strip("/")
        if not _ensure_remote_folder(remote_dir, folder_cache):
            log.error("Aborting sync: could not create folder %s", remote_dir)
            return False

    # Enumerate remote files under remote_root (recursive listing)
    remote_files = {}  # rel_path -> item

    def _list_recursive(prefix_path: str, prefix_rel: str):
        items = get_remote_children(prefix_path)
        for name, item in items.items():
            rel = f"{prefix_rel}/{name}".strip("/")
            if "folder" in item:
                _list_recursive(f"{prefix_path}/{name}".strip("/"), rel)
            else:
                remote_files[rel] = item

    _list_recursive(remote_root_stripped, "")

    uploaded = 0
    skipped = 0
    deleted = 0
    failed = 0

    for rel, local_path in sorted(local_files.items()):
        remote_path = f"{remote_root_stripped}/{rel}".strip("/")
        remote_item = remote_files.get(rel)

        if remote_item:
            remote_size = remote_item.get("size", -1)
            local_size = local_path.stat().st_size
            r_hash = remote_file_hash(remote_item)
            l_hash = local_file_hash(local_path) if r_hash else ""

            # Skip if both size and hash match, or size alone if no hash available
            if remote_size == local_size and (not r_hash or r_hash.lower() == l_hash.lower()):
                skipped += 1
                continue

        if dry_run:
            log.info("[DRY-RUN] Would upload %s -> %s", local_path, remote_path)
            uploaded += 1
            continue

        parent_dir = str(Path(rel).parent)
        if parent_dir != ".":
            remote_parent = f"{remote_root_stripped}/{parent_dir}".strip("/")
            if not _ensure_remote_folder(remote_parent, folder_cache):
                log.error("Failed to ensure parent folder for %s", rel)
                failed += 1
                continue

        if upload_file(local_path, remote_path):
            uploaded += 1
        else:
            failed += 1
            log.error("Failed upload %s", local_path)

    if delete_remote:
        local_rels = set(local_files.keys())
        for rel in list(remote_files.keys()):
            if rel not in local_rels:
                remote_path = f"{remote_root_stripped}/{rel}".strip("/")
                if dry_run:
                    log.info("[DRY-RUN] Would delete %s", remote_path)
                    deleted += 1
                    continue
                if delete_remote_file(remote_path):
                    deleted += 1
                else:
                    failed += 1

    log.info("Sync complete. Uploaded: %d, Skipped: %d, Deleted: %d, Failed: %d",
             uploaded, skipped, deleted, failed)
    return failed == 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="OneDrive Sync via Microsoft Graph")
    parser.add_argument("--auth", action="store_true", help="Authenticate and save tokens")
    parser.add_argument("--sync", nargs=2, metavar=("LOCAL", "REMOTE"), help="Sync local folder to remote folder")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be uploaded without doing it")
    parser.add_argument("--delete-remote", action="store_true", help="Delete remote files not present locally")
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Additional exclude pattern (can be used multiple times). Supports glob (*, ?, **).",
    )
    args = parser.parse_args()

    if args.auth:
        authenticate()
        return

    if args.sync:
        local, remote = args.sync
        ok = sync_folder(
            Path(local),
            remote,
            dry_run=args.dry_run,
            delete_remote=args.delete_remote,
            extra_excludes=args.exclude,
        )
        sys.exit(0 if ok else 1)

    parser.print_help()


if __name__ == "__main__":
    main()
