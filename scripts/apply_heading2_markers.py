from __future__ import annotations

import argparse
import re
import shutil
from datetime import datetime
from pathlib import Path

from docx import Document


MARKER_PATTERN = re.compile(r"^(?:[A-Z]-\d+(?:/[^\s]+)?|S\.?\d+)$", re.IGNORECASE)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="sourceFiles/orginals")
    parser.add_argument("--skip-backup", action="store_true")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    files = sorted(source.glob("*.docx"))
    if not files:
        raise SystemExit(f"No .docx files found in {source}")

    if not args.skip_backup:
        backup = source / f"heading2-backup-{datetime.now():%Y%m%d-%H%M%S}"
        backup.mkdir()
        for file in files:
            shutil.copy2(file, backup / file.name)
        print(f"Backup: {backup}")

    for file in files:
        document = Document(file)
        heading_style = document.styles["heading 2"]
        changed = 0
        for paragraph in document.paragraphs:
            if MARKER_PATTERN.fullmatch(paragraph.text.strip()):
                paragraph.style = heading_style
                changed += 1
        document.save(file)
        print(f"{file.name}: {changed} Heading 2 styles applied")


if __name__ == "__main__":
    main()
