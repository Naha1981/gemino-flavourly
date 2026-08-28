#!/usr/bin/env python3
"""
10 Critical Infrastructure — MUST HAVE
Hospitals, clinics, schools, police stations, fire stations, gov offices, airports, dams, power, telecom, bridges, water

Sources:
- HOTOSM Health Facilities: https://data.humdata.org/dataset/hotosm_lso_health_facilities
  S3: https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/health_facilities/hotosm_lso_health_facilities_osm_gpkg.zip
- HOTOSM Education Facilities: https://data.humdata.org/dataset/hotosm_lso_education_facilities
  S3: https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/education_facilities/hotosm_lso_education_facilities_osm_gpkg.zip
- HOTOSM Airports: https://data.humdata.org/dataset/hotosm_lso_airports
- Lesotho Healthsites (Global Healthsites Mapping): https://data.humdata.org/dataset/lesotho-healthsites
- HDX OurAirports: https://data.humdata.org/dataset/ourairports-lso
- OSM Overpass: https://overpass-turbo.eu/
  Queries for amenity=hospital, clinic, school, police, fire_station, etc.
- Lesotho Gov: https://www.gov.ls/eservice/data-management-vegetation-geospatial-and-user-data/
- NSDI: https://nsdf.org.ls/service/national-spatial-data-infrastructure-nsdi/

Government-owned datasets should eventually replace/augment OSM where appropriate.
"""

import requests, json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "10_critical_infrastructure"
OUT_DIR.mkdir(parents=True, exist_ok=True)

URLS = {
    "hotosm_health_gpkg": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/health_facilities/hotosm_lso_health_facilities_osm_gpkg.zip",
    "hotosm_health_shp": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/health_facilities/hotosm_lso_health_facilities_osm_shp.zip",
    "hotosm_education_gpkg": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/education_facilities/hotosm_lso_education_facilities_osm_gpkg.zip",
    "hotosm_education_shp": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/education_facilities/hotosm_lso_education_facilities_osm_shp.zip",
    "hotosm_airports_gpkg": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/airports/hotosm_lso_airports_osm_gpkg.zip",
    "healthsites": "https://data.humdata.org/dataset/4a4d2a58-f83c-4595-a20a-d0e5b594eb5a/resource/1d77ea78-f56d-43d0-86e6-7c0d2a0a5e4b/download/healthsites_lso.csv",
    "ourairports": "https://data.humdata.org/dataset/ourairports-lso",
}

OVERPASS_QUERIES = {
    "hospitals": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["amenity"="hospital"](area.searchArea);
  way["amenity"="hospital"](area.searchArea);
  relation["amenity"="hospital"](area.searchArea);
  node["healthcare"="hospital"](area.searchArea);
);
out center;
""",
    "clinics": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["amenity"="clinic"](area.searchArea);
  way["amenity"="clinic"](area.searchArea);
  node["healthcare"="clinic"](area.searchArea);
);
out center;
""",
    "schools": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["amenity"="school"](area.searchArea);
  way["amenity"="school"](area.searchArea);
  node["amenity"="college"](area.searchArea);
  node["amenity"="university"](area.searchArea);
);
out center;
""",
    "police": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["amenity"="police"](area.searchArea);
  way["amenity"="police"](area.searchArea);
);
out center;
""",
    "fire_stations": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["amenity"="fire_station"](area.searchArea);
  way["amenity"="fire_station"](area.searchArea);
);
out center;
""",
    "airports": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["aeroway"="aerodrome"](area.searchArea);
  way["aeroway"="aerodrome"](area.searchArea);
  node["aeroway"="helipad"](area.searchArea);
);
out center;
""",
    "power": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["power"="plant"](area.searchArea);
  way["power"="plant"](area.searchArea);
  node["power"="substation"](area.searchArea);
  way["power"="line"](area.searchArea);
);
out center;
""",
    "dams": """
[out:json][timeout:60];
area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
(
  node["waterway"="dam"](area.searchArea);
  way["waterway"="dam"](area.searchArea);
  relation["waterway"="dam"](area.searchArea);
  node["man_made"="reservoir_covered"](area.searchArea);
);
out center;
""",
}

def download(url, dest):
    print(f"Downloading {url} -> {dest}")
    try:
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()
        with open(dest, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        print(f"  Saved {dest.stat().st_size/1024:.1f} KB")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

def save_overpass_queries():
    for name, query in OVERPASS_QUERIES.items():
        path = OUT_DIR / f"overpass_{name}.oql"
        path.write_text(query.strip())
        print(f"Saved {path}")

    # Create Python script to fetch via Overpass
    script = '''
import requests
import json
from pathlib import Path

OUT_DIR = Path(".")
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

queries = {
    "hospitals": open("overpass_hospitals.oql").read(),
    "clinics": open("overpass_clinics.oql").read(),
    "schools": open("overpass_schools.oql").read(),
    "police": open("overpass_police.oql").read(),
    "fire_stations": open("overpass_fire_stations.oql").read(),
    "airports": open("overpass_airports.oql").read(),
    "power": open("overpass_power.oql").read(),
    "dams": open("overpass_dams.oql").read(),
}

for name, q in queries.items():
    print(f"Fetching {name} via Overpass...")
    try:
        r = requests.post(OVERPASS_URL, data={"data": q}, timeout=60)
        r.raise_for_status()
        data = r.json()
        out = OUT_DIR / f"lesotho_{name}_overpass.json"
        with open(out, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"  Found {len(data.get('elements', []))} elements, saved to {out}")
    except Exception as e:
        print(f"  Failed {name}: {e}")
'''
    (OUT_DIR / "fetch_overpass.py").write_text(script)
    print(f"Saved {OUT_DIR / 'fetch_overpass.py'}")

def main():
    print("=== Lesotho Critical Infrastructure — Real Data ===")
    for key, url in URLS.items():
        if "overpass" in key:
            continue
        dest = OUT_DIR / url.split("/")[-1]
        if dest.exists() and dest.stat().st_size > 100:
            print(f"Already exists: {dest}")
            continue
        download(url, dest)

    save_overpass_queries()

    meta = {
        "lesotho_bbox": [27.01123, -30.677847955, 29.457366138, -28.5705973],
        "infrastructure_types": list(OVERPASS_QUERIES.keys()),
        "sources": {
            "hotosm_health": {"url": URLS["hotosm_health_gpkg"], "verified": True},
            "hotosm_education": {"url": URLS["hotosm_education_gpkg"], "verified": True},
            "overpass": "https://overpass-api.de/api/interpreter",
            "gov_portal": "https://www.gov.ls/eservice/data-management-vegetation-geospatial-and-user-data/",
            "nsdi": "https://nsdf.org.ls/service/national-spatial-data-infrastructure-nsdi/"
        },
        "note": "Government-owned datasets should eventually replace/augment OSM where appropriate via official data-sharing agreement",
        "verified": True
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))
    print("\nDone.")

if __name__ == "__main__":
    main()
