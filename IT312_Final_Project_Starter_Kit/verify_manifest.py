"""Reference check for R14: verify a drop-folder file against its signed manifest.

Usage: STARTER_HMAC_KEY=... python3 verify_manifest.py drop_folder/accounting_balances_2026-11-20.csv
Your importer must do these checks itself before reading any record.
"""
import hashlib
import hmac
import json
import os
import sys

key = os.environ.get("STARTER_HMAC_KEY", "").encode()
if not key:
    sys.exit("Set STARTER_HMAC_KEY (see README)")
path = sys.argv[1]
with open(path + ".manifest.json", encoding="utf-8") as f:
    m = json.load(f)
body = json.dumps({k: v for k, v in m.items() if k != "signature"}, sort_keys=True, separators=(",", ":")).encode()
if not hmac.compare_digest(hmac.new(key, body, hashlib.sha256).hexdigest(), m["signature"]):
    sys.exit(f"REJECTED {path}: manifest signature invalid")
with open(path, "rb") as f:
    if hashlib.sha256(f.read()).hexdigest() != m["sha256"]:
        sys.exit(f"REJECTED {path}: file altered after signing (hash mismatch)")
print(f"OK {path}: signature and hash valid, {m['record_count']} records, source={m['source']}")
