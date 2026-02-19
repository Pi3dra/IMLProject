from pathlib import Path
import json

root = Path("Dataset_resized")           # ← adjust to your actual folder
base_url = ""                   # "/" or "/images" etc. – whatever your server uses

data = []

for file in root.rglob("*"):    # ← get EVERY file recursively
    if file.is_file() and file.suffix.lower() in {".jpg", ".jpeg", ".png"}:
        rel = file.relative_to(root).as_posix()
        folder = file.parent.name
        # Simple label logic – improve as needed
        label = folder.capitalize() if folder.lower() in {"oil", "manga", "digital", "studies"} else "unknown"
        
        entry = {
            "x": f"{base_url}/{rel}",
            "y": label,
            "thumbnail": f"{base_url}/{rel}"   # same image as thumb, or make real thumbs later
        }
        data.append(entry)

# Optional: sort for consistency
data.sort(key=lambda e: e["x"])

with open(root / "index.json", "w") as f:
    json.dump(data, f, indent=2)

print(f"Generated index with {len(data)} images")
