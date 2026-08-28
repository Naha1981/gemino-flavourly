# Lesotho Guardian AI — Architecture

## Overview

```
                  LESOTHO GUARDIAN AI
                          │
                   AI GEO-COPILOT
                          │
                  ┌───────▼───────┐
                  │     PostGIS   │
                  │ Spatial Brain │
                  └───────┬───────┘
                          │
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
  SATELLITES          ENVIRONMENT         HUMAN DATA
 Sentinel-1/2         Weather              Police
 Landsat              Rainfall             Emergency
 FIRMS                Rivers               Field reports
 DEM                  Fires                Government
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ▼
                    RISK / EVENT
                       ENGINE
                          │
                          ▼
                  GOD'S EYE VIEW
                    CESIUM 3D
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
           POLICE        LDF         DISASTER
```

## Spatial Brain — PostGIS Schema

```sql
-- Enable PostGIS
CREATE EXTENSION postgis;
CREATE EXTENSION postgis_raster;

-- 01 Admin boundaries
CREATE TABLE admin_0 (
  id SERIAL PRIMARY KEY,
  name TEXT, -- Lesotho
  iso_a3 TEXT, -- LSO
  geom GEOMETRY(MultiPolygon, 4326)
);
CREATE TABLE admin_1 (
  id SERIAL PRIMARY KEY,
  name TEXT, -- Berea, etc.
  pcode TEXT, -- LS-B etc.
  geom GEOMETRY(MultiPolygon, 4326)
);
CREATE TABLE admin_2 (
  id SERIAL PRIMARY KEY,
  name TEXT,
  district TEXT,
  pcode TEXT,
  geom GEOMETRY(MultiPolygon, 4326)
);

-- 02 Roads
CREATE TABLE roads (
  id SERIAL PRIMARY KEY,
  osm_id BIGINT,
  highway TEXT, -- motorway, primary, secondary, residential, track
  name TEXT,
  bridge BOOLEAN,
  surface TEXT,
  geom GEOMETRY(LineString, 4326)
);
CREATE INDEX ON roads USING GIST(geom);

-- 03 Settlements & Buildings
CREATE TABLE settlements (
  id SERIAL PRIMARY KEY,
  name TEXT,
  place TEXT, -- city, village, hamlet
  population INT,
  geom GEOMETRY(Point, 4326)
);
CREATE TABLE buildings (
  id SERIAL PRIMARY KEY,
  osm_id BIGINT,
  building TEXT,
  area FLOAT,
  geom GEOMETRY(Polygon, 4326)
);

-- 04 Population (raster)
CREATE TABLE population_raster (
  rid SERIAL PRIMARY KEY,
  rast RASTER
);
-- Or vectorized H3
CREATE TABLE population_h3 (
  h3_index TEXT PRIMARY KEY,
  population INT,
  geom GEOMETRY(Polygon, 4326)
);

-- 05 Satellite (metadata)
CREATE TABLE satellite_scenes (
  id TEXT PRIMARY KEY,
  collection TEXT, -- sentinel-2-l2a, sentinel-1-rtc
  datetime TIMESTAMPTZ,
  cloud_cover FLOAT,
  bbox GEOMETRY(Polygon, 4326),
  stac_url TEXT,
  s3_url TEXT
);

-- 06 Fire
CREATE TABLE active_fires (
  id SERIAL PRIMARY KEY,
  latitude FLOAT,
  longitude FLOAT,
  bright_ti4 FLOAT,
  acq_date DATE,
  acq_time TEXT,
  satellite TEXT, -- N, N20, N21
  instrument TEXT, -- VIIRS, MODIS
  confidence TEXT,
  frp FLOAT,
  geom GEOMETRY(Point, 4326)
);

-- 07 Weather
CREATE TABLE weather_daily (
  id SERIAL PRIMARY KEY,
  date DATE,
  district TEXT,
  lat FLOAT,
  lon FLOAT,
  temp_max FLOAT,
  temp_min FLOAT,
  precip_mm FLOAT,
  wind_max_kmh FLOAT,
  source TEXT -- open-meteo, chirps, era5
);

-- 08 Hydrology
CREATE TABLE rivers (
  id SERIAL PRIMARY KEY,
  length_km FLOAT,
  dist_up_km FLOAT,
  dist_dn_km FLOAT,
  strahler INT,
  dis_m3_psec FLOAT,
  geom GEOMETRY(LineString, 4326)
);
CREATE TABLE lakes (
  id SERIAL PRIMARY KEY,
  lake_area FLOAT,
  geom GEOMETRY(Polygon, 4326)
);
CREATE TABLE watersheds (
  id SERIAL PRIMARY KEY,
  hybas_id BIGINT,
  area_km2 FLOAT,
  geom GEOMETRY(Polygon, 4326)
);

-- 09 DEM
CREATE TABLE dem_tiles (
  rid SERIAL PRIMARY KEY,
  rast RASTER,
  filename TEXT
);
CREATE TABLE terrain_derived (
  id SERIAL PRIMARY KEY,
  type TEXT, -- slope, aspect, hillshade
  rast RASTER
);

-- 10 Critical Infrastructure
CREATE TABLE critical_infrastructure (
  id SERIAL PRIMARY KEY,
  osm_id BIGINT,
  type TEXT, -- hospital, clinic, school, police, fire_station, airport, dam, power
  name TEXT,
  amenity TEXT,
  healthcare TEXT,
  capacity INT,
  geom GEOMETRY(Point, 4326)
);
CREATE INDEX ON critical_infrastructure USING GIST(geom);
CREATE INDEX ON critical_infrastructure (type);
```

## Risk / Event Engine

### Flood Risk (DisasterGuard)

```text
Heavy rainfall (CHIRPS 0.05° + Open-Meteo)
      +
River proximity (HydroRIVERS buffer 500m)
      +
Elevation (Copernicus DEM 30m low-lying)
      ↓
Flood risk raster (0-1)
      ↓
Affected settlements (intersect with OSM populated places)
      ↓
Affected roads (intersect with HOTOSM roads)
      ↓
Affected infrastructure (hospitals, schools)
      ↓
Affected population (zonal stats WorldPop 100m)
```

SQL example:

```sql
-- Flood risk = precip > 20mm AND elevation < 1800m AND within 500m of river
WITH rainy AS (
  SELECT * FROM weather_daily WHERE precip_mm > 20 AND date = CURRENT_DATE
),
low_elev AS (
  SELECT (ST_DumpAsPolygons(rast)).* FROM dem_tiles WHERE ST_Intersects(rast, (SELECT geom FROM admin_0))
),
river_buffer AS (
  SELECT ST_Buffer(geom::geography, 500)::geometry AS geom FROM rivers
)
SELECT 
  s.name,
  SUM(p.population) as affected_pop
FROM settlements s
JOIN population_h3 p ON ST_Intersects(s.geom, p.geom)
WHERE ST_Intersects(s.geom, (SELECT ST_Union(geom) FROM river_buffer))
GROUP BY s.name;
```

### Fire Risk

```
Active fires (FIRMS VIIRS 375m) + Temperature + Wind + Vegetation (Sentinel-2 NDVI) → Fire risk
```

### Landslide

```
Slope (from DEM) + Rainfall + Soil + Road proximity → Landslide susceptibility
Lesotho is mountainous, critical for road accessibility.
```

## God's Eye View — Cesium 3D

```javascript
// Load Lesotho boundaries
Cesium.GeoJsonDataSource.load('datasets/01_admin_boundaries/LSO_world.geo.json', {
  stroke: Cesium.Color.BLUE,
  fill: Cesium.Color.BLUE.withAlpha(0.1),
  strokeWidth: 2
});

// Load DEM as terrain
viewer.terrainProvider = new Cesium.CesiumTerrainProvider({
  url: Cesium.IonResource.fromAssetId(1) // or custom Copernicus DEM tiles
});

// Load population as 3D bars
// Load roads as polylines
// Load fires as billboards with time animation
```

## Ingestion Pipeline

- **Airflow or cron**: daily fetch for FIRMS, CHIRPS, Open-Meteo, Sentinel-2 via STAC
- **PostGIS**: spatial brain, all layers indexed
- **AI Geo-Copilot**: LLM that translates natural language to PostGIS queries
  - "Show me villages within 1km of active fires in Quthing" → SQL
  - "How many people affected by flood in Maseru?" → zonal stats

## NSDI Integration

Lesotho NSDI (https://nsdf.org.ls/service/national-spatial-data-infrastructure-nsdi/) provides geospatial data environment for government, NGOs, private sector.

Pitch: "We're not asking government to buy another map. We're building an AI layer on top of Lesotho's national geospatial data infrastructure."

- Use DRWS official service: https://drws.gov.ls/server/rest/services/LesothoBoundaries/MapServer
- Gov data portal: https://www.gov.ls/eservice/data-management-vegetation-geospatial-and-user-data/
- Eventually replace OSM with official gov datasets via authorized agreement.
