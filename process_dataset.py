import os
from PIL import Image
from tqdm import tqdm

# ===== SETTINGS =====
INPUT_DIR = "Dataset"
OUTPUT_DIR = "Dataset_resized"
TARGET_SIZE = (256, 256) 
JPEG_QUALITY = 85          # 80–90 = good compression
# ====================


def process_image(input_path, output_path):
    try:
        with Image.open(input_path) as img:
            img = img.convert("RGB")
            img = img.resize(TARGET_SIZE, Image.Resampling.LANCZOS)

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            img.save(output_path, "JPEG", quality=JPEG_QUALITY, optimize=True)

    except Exception as e:
        print(f"Skipped {input_path}: {e}")


def process_dataset():
    print("Processing dataset...\n")

    # Loop over each class folder (Digital, Manga, etc.)
    for class_name in sorted(os.listdir(INPUT_DIR)):
        class_path = os.path.join(INPUT_DIR, class_name)

        if not os.path.isdir(class_path):
            continue

        print(f"Processing class: {class_name}")

        # Counter for renaming
        counter = 1

        # Sort files to ensure same order every run
        files = sorted(os.listdir(class_path))

        for file in tqdm(files):
            if not file.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff")):
                continue

            input_path = os.path.join(class_path, file)

            # Build new clean filename
            new_filename = f"{class_name.lower()}{counter}.jpg"

            output_class_dir = os.path.join(OUTPUT_DIR, class_name)
            output_path = os.path.join(output_class_dir, new_filename)

            process_image(input_path, output_path)

            counter += 1

    print("\nDone ✅")
    print(f"Saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    process_dataset()

