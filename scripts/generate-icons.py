#!/opt/homebrew/bin/python3

import argparse
import shutil
import struct
import subprocess
import sys
from pathlib import Path


ICNS_TYPES = {
    16: b"icp4",
    32: b"icp5",
    64: b"icp6",
    128: b"ic07",
    256: b"ic08",
    512: b"ic09",
    1024: b"ic10",
}

PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def run(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed: {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )


def resize_png(source: Path, destination: Path, size: int):
    destination.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "/usr/bin/sips",
            "-s",
            "format",
            "png",
            "-z",
            str(size),
            str(size),
            str(source),
            "--out",
            str(destination),
        ]
    )


def build_ico(png_dir: Path, destination: Path):
    png_payloads = []
    for size in ICO_SIZES:
        payload = (png_dir / f"icon-{size}.png").read_bytes()
        width_byte = 0 if size >= 256 else size
        height_byte = 0 if size >= 256 else size
        png_payloads.append((width_byte, height_byte, payload))

    icon_dir = struct.pack("<HHH", 0, 1, len(png_payloads))
    entry_size = 16
    offset = 6 + len(png_payloads) * entry_size
    entries = []
    data_blocks = []

    for width_byte, height_byte, payload in png_payloads:
        entries.append(
            struct.pack(
                "<BBBBHHII",
                width_byte,
                height_byte,
                0,
                0,
                1,
                32,
                len(payload),
                offset,
            )
        )
        data_blocks.append(payload)
        offset += len(payload)

    destination.write_bytes(icon_dir + b"".join(entries) + b"".join(data_blocks))


def build_icns(png_dir: Path, destination: Path):
    chunks = []
    total_length = 8

    for size, icon_type in ICNS_TYPES.items():
        payload = (png_dir / f"icon-{size}.png").read_bytes()
        chunk_length = 8 + len(payload)
        chunks.append(icon_type + struct.pack(">I", chunk_length) + payload)
        total_length += chunk_length

    destination.write_bytes(b"icns" + struct.pack(">I", total_length) + b"".join(chunks))


def generate_icons(source: Path, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    png_dir = output_dir / "png"
    png_dir.mkdir(parents=True, exist_ok=True)

    for size in PNG_SIZES:
        resize_png(source, png_dir / f"icon-{size}.png", size)

    shutil.copy2(png_dir / "icon-1024.png", output_dir / "icon.png")
    build_icns(png_dir, output_dir / "app.icns")
    build_ico(png_dir, output_dir / "app.ico")


def parse_args():
    parser = argparse.ArgumentParser(description="Generate Electron app icons.")
    parser.add_argument("source", type=Path, help="Source PNG image")
    parser.add_argument("output", type=Path, help="Output icon directory")
    return parser.parse_args()


def main():
    args = parse_args()
    source = args.source.expanduser().resolve()
    output_dir = args.output.expanduser().resolve()

    if not source.is_file():
        raise FileNotFoundError(f"Source image not found: {source}")

    generate_icons(source, output_dir)
    print(f"Generated icons in {output_dir}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
