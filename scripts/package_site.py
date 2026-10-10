"""Package only the static site; does not publish anything."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / "dist" / "c3-practice-site.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted((root / "public").rglob("*")):
        if path.is_file() and not path.name.startswith("."):
            archive.write(path, path.relative_to(root / "public"))
print(output)
