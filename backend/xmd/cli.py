"""Filesystem-authenticated operator commands; no administrative HTTP routes."""

import argparse
import sys
from pathlib import Path

from .config import Config
from .security import APIError, json_bytes, private_write, public_key
from .service import Service


def main(argv=None):
    parser = argparse.ArgumentParser(description="XMD trusted local operator")
    parser.add_argument("--state-dir", type=Path, help="private state directory outside repository")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    commands.add_parser("public-key")
    issue = commands.add_parser("issue")
    issue.add_argument("--output", type=Path, required=True, help="new private delivery file; never overwritten")
    revoke = commands.add_parser("revoke")
    revoke.add_argument("--license-id", required=True)
    try:
        args = parser.parse_args(argv)
        config = Config.from_env()
        if args.state_dir:
            config.state_dir = args.state_dir
        # Offline commands never need or contact payment providers.
        config.payments_enabled = False
        service = Service(config)
        if args.command == "public-key":
            print(public_key(service.key))
        elif args.command == "issue":
            output = args.output.absolute()
            source = Path(__file__).resolve().parents[2]
            if output.resolve() == source or source in output.resolve().parents:
                raise ValueError("license delivery file must be outside repository")
            with service.store.transaction() as db:
                identity, code = service.store.insert_license(db)
                private_write(output, json_bytes({"license_id": identity, "code": code}) + b"\n")
            print("Issued license " + identity + "; delivery file created (code not logged).")
        elif args.command == "revoke":
            service.store.revoke(args.license_id)
            print("License revoked.")
        else:
            print("Runtime state initialized.")
        return 0
    except (APIError, OSError, ValueError, RuntimeError):
        print("Operator command failed; check configuration, paths and private permissions.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
