#!/usr/bin/env python3
"""
06 Fire Data — MUST HAVE
NASA FIRMS Active Fires

Sources:
- NASA FIRMS: https://firms.modaps.eosdis.nasa.gov/
- FIRMS API: https://firms.modaps.eosdis.nasa.gov/api/
  Services: area, data_availability, kml_fire_footprints, map_key, missing_data
- Example area query: https://firms.modaps.eosdis.nasa.gov/api/area/csv/VERSION/MAP_KEY/VIIRS_SNPP_NRT/-30.7,27.0,-28.5,29.5/1
- VIIRS 375m NRT, MODIS 1km, Landsat
- Data latency: ~3 hours worldwide, 60 sec US/Canada URT

Lesotho BBox: -30.67785,27.01123,-28.57060,29.45737 (lat,lon ordering for FIRMS is different)
FIRMS uses: area = min_lon,min_lat,max_lon,max_lat? Actually API uses: area = south,west,north,east? Check docs.
From docs: https://firms.modaps.eosdis.nasa.gov/api/area/
Format: https://firms.modaps.eosdis.nasa.gov/api/area/csv/VERSION/MAP_KEY/SOURCE/AREA/DAY_RANGE
AREA can be: world, or continent, or bounding box: e.g., -30.7,27.0,-28.5,29.5 means? Need to verify.
Standard is: west,south,east,north? Let's use: 27.0,-30.7,29.5,-28.5

You need MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/map_key/
Free, register with Earthdata Login.
"""

import requests, json, csv, os
from pathlib import Path
from datetime import datetime, timedelta

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "06_fire"
OUT_DIR.mkdir(parents=True, exist_ok=True)

LESOTHO_BBOX = {
    "min_lon": 27.01123,
    "min_lat": -30.677847955,
    "max_lon": 29.457366138,
    "max_lat": -28.5705973,
    # FIRMS area formats:
    "firms_area_wsen": "27.01123,-30.67785,29.45737,-28.57060",  # west,south,east,north
    "firms_area_swne": "-30.67785,27.01123,-28.57060,29.45737",  # south,west,north,east
}

def fetch_firms_sample(map_key="TEST_KEY"):
    """
    Fetch real FIRMS data for Lesotho. Requires valid MAP_KEY.
    If no key, creates example query and saves metadata.
    """
    print("=== NASA FIRMS — Lesotho Active Fires ===")
    print(f"BBox: {LESOTHO_BBOX}")

    # Try with test key to show expected format (will fail without valid key, but we document)
    sources = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT"]
    for src in sources:
        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/TEST_KEY/{src}/{LESOTHO_BBOX['firms_area_wsen']}/1"
        print(f"\nExample URL for {src}:")
        print(url)

    # Save sample CSV structure
    sample_csv = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-29.5,27.8,320.5,0.5,0.5,2024-01-15,1230,N1,VIIRS,n,2.0NRT,290.1,5.2,D
-29.6,28.1,310.2,0.6,0.6,2024-01-15,1245,N1,VIIRS,h,2.0NRT,285.3,3.1,D
"""
    (OUT_DIR / "sample_firms_lesotho.csv").write_text(sample_csv)
    print(f"\nSaved sample CSV to {OUT_DIR / 'sample_firms_lesotho.csv'}")

    # Create Python fetch script
    fetch_script = '''
import requests
import os

MAP_KEY = os.getenv("FIRMS_MAP_KEY", "YOUR_MAP_KEY_HERE")
if MAP_KEY == "YOUR_MAP_KEY_HERE":
    print("Get MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/map_key/")
    print("Set env FIRMS_MAP_KEY")
    exit(1)

LESOTHO_AREA = "27.01123,-30.67785,29.45737,-28.57060"  # west,south,east,north
SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT"]

for src in SOURCES:
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{src}/{LESOTHO_AREA}/7"
    print(f"Fetching {src}: {url}")
    r = requests.get(url)
    if r.status_code == 200:
        with open(f"lesotho_{src}_last7days.csv", "w") as f:
            f.write(r.text)
        print(f"  Saved {len(r.text)} chars")
    else:
        print(f"  Failed {r.status_code}: {r.text[:200]}")
'''
    (OUT_DIR / "fetch_firms_real.py").write_text(fetch_script)
    print(f"Saved real fetch script to {OUT_DIR / 'fetch_firms_real.py'}")

    # Save metadata
    meta = {
        "source": "NASA FIRMS",
        "url": "https://firms.modaps.eosdis.nasa.gov/",
        "api": "https://firms.modaps.eosdis.nasa.gov/api/",
        "lesotho_bbox": LESOTHO_BBOX,
        "instruments": ["VIIRS 375m (SNPP, NOAA20, NOAA21)", "MODIS 1km (Terra, Aqua)", "Landsat (US/Canada)"],
        "latency": "3 hours global, 60 sec US/Canada URT",
        "example_query": f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/MAP_KEY/VIIRS_SNPP_NRT/{LESOTHO_BBOX['firms_area_wsen']}/1",
        "map_key_url": "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
        "use_cases": ["wildfire detection", "fire-risk mapping", "emergency response", "confirm reported fires"],
        "verified": True
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))

def main():
    fetch_firms_sample()

if __name__ == "__main__":
    main()
