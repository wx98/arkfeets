"""Paths shared by the local PRTS data pipeline."""

import os
import sys
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[4]
WORK_DIR = PROJECT_ROOT / "tmp" / "Arknights_PRTS"
IMAGE_DIR = WORK_DIR / "operators"
CONTEXT_DIR = PROJECT_ROOT / ".ai-context"
WIKI_CACHE_DIR = CONTEXT_DIR / "wiki_cache"
HINTS_JSON = CONTEXT_DIR / "hints_merged.json"
OPERATORS_JSON = CONTEXT_DIR / "prts_operators.json"
FULL_DATA_DIR = PROJECT_ROOT / "server" / "resource" / "full_data"


def prepare_workspace():
    """Keep Python, Selenium Manager and Edge scratch files beside pipeline data."""
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_DIR.mkdir(exist_ok=True)
    scratch = WORK_DIR / "temp"
    scratch.mkdir(exist_ok=True)
    for key in ("TMP", "TEMP", "TMPDIR", "XDG_CACHE_HOME", "SE_CACHE_PATH"):
        os.environ[key] = str(scratch)
    tempfile.tempdir = str(scratch)
    sys.dont_write_bytecode = True
