#!/usr/bin/env python3
"""
Lesotho Guardian AI — Master Download Script
Downloads all 10 core data families (MUST HAVE) with real, verified data.

Usage:
  python master_download.py --all
  python master_download.py --family admin,roads,population
  python master_download.py --sample  # only small real samples (works in sandbox)

Sandbox note: Direct egress to S3/HDX/Geofabrik blocked via curl (SSL_ERROR_SYSCALL),
but fetch_page proxy and github.com git clone work. This script is designed for
production with full internet. Real samples already included where proxy allowed.
"""

import argparse
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
SCRIPTS = {
    "admin": "fetch_01_admin.py",
    "roads": "fetch_02_roads.py",
    "settlements": "fetch_03_settlements.py",
    "population": "fetch_04_population.py",
    "satellite": "fetch_05_satellite.py",
    "fire": "fetch_06_fire.py",
    "weather": "fetch_07_weather.py",
    "hydrology": "fetch_08_hydrology.py",
    "dem": "fetch_09_dem.py",
    "infrastructure": "fetch_10_infrastructure.py",
}

def run_script(name):
    script_path = Path(__file__).parent / SCRIPTS[name]
    print(f"\n{'='*60}\nRunning {name}: {script_path}\n{'='*60}")
    try:
        result = subprocess.run([sys.executable, str(script_path)], check=False)
        print(f"Exit code {result.returncode} for {name}")
        return result.returncode == 0
    except Exception as e:
        print(f"Failed to run {name}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Lesotho Guardian Master Download")
    parser.add_argument("--all", action="store_true", help="Download all families")
    parser.add_argument("--family", type=str, help="Comma-separated families: admin,roads,settlements,population,satellite,fire,weather,hydrology,dem,infrastructure")
    parser.add_argument("--sample", action="store_true", help="Only fetch small real samples that work in sandbox")
    args = parser.parse_args()

    if args.sample:
        print("=== SAMPLE MODE — Real data that works in sandbox ===")
        # These work via fetch_page proxy or git clone
        run_script("admin")
        run_script("weather")  # Open-Meteo works
        run_script("satellite")  # Creates ingestion scripts, no download
        run_script("fire")
        print("\nSample mode done. Real samples in datasets/01_admin_boundaries/LSO_world.geo.json and datasets/07_weather_rainfall/")
        return

    families = []
    if args.all:
        families = list(SCRIPTS.keys())
    elif args.family:
        families = [f.strip() for f in args.family.split(",") if f.strip() in SCRIPTS]
    else:
        print("No args, defaulting to --all")
        families = list(SCRIPTS.keys())

    print(f"Families to download: {families}")
    results = {}
    for fam in families:
        results[fam] = run_script(fam)

    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    for fam, ok in results.items():
        print(f"  {fam}: {'✅ OK' if ok else '❌ FAILED (may need full internet)'}")

    print("\nNext steps:")
    print("  1. python scripts/verify_datasets.py")
    print("  2. Load into PostGIS: see docs/architecture.md")
    print("  3. Cesium 3D: load GeoJSON + DEM")

if __name__ == "__main__":
    main()
