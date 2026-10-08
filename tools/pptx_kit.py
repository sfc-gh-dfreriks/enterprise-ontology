#!/usr/bin/env python3
"""Shim onto the shared Snowflake-template PPTX toolkit.

The implementation lives once, versioned with the Finance repo, at

    sap-bdc-finance-360/tools/sap_pptx_kit.py

Finance, Sales and the Supply Chain one-pagers all import it through a shim like
this one so they share the same helpers and the same slide verifiers, rather than
each carrying a copy that could drift.

Add nothing here. Edit sap_pptx_kit.py instead.
"""
import pathlib
import sys

_OWNER = (pathlib.Path.home() / "Documents" / "SAP" / "SAP Skills"
          / "sap-bdc-finance-360" / "tools")
if not (_OWNER / "sap_pptx_kit.py").exists():
    raise ImportError(f"shared pptx kit not found at {_OWNER}/sap_pptx_kit.py")
if str(_OWNER) not in sys.path:
    sys.path.insert(0, str(_OWNER))

from sap_pptx_kit import *  # noqa: F401,F403
