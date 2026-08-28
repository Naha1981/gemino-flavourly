# Lesotho Guardian AI — NSDI Pitch

## The Pitch

> **"We're not asking government to buy another map. We're building an AI layer on top of Lesotho's national geospatial data infrastructure."**

## Context

Lesotho is pursuing a **National Spatial Data Infrastructure (NSDI)** intended to provide a geospatial data environment for government, NGOs and private sector. Source: https://nsdf.org.ls/service/national-spatial-data-infrastructure-nsdi/

There is already an official Lesotho boundaries service with district and community-council layers: https://drws.gov.ls/server/rest/services/LesothoBoundaries/MapServer

Government has a specific service for obtaining vegetation/geospatial data: https://www.gov.ls/eservice/data-management-vegetation-geospatial-and-user-data/

## What We Bring

- **AI Geo-Copilot**: Natural language to PostGIS queries — "Show me villages within 1km of active fires in Quthing"
- **Risk Engine**: Heavy rainfall + River proximity + Elevation → Flood risk → Affected settlements/roads/infrastructure → Affected population (WorldPop 100m)
- **God's Eye View**: Cesium 3D visualization of all layers
- **Modular**: PoliceGuard, DefenceGuard, DisasterGuard share same spatial brain

## MVP Dataset Stack (First 11 Enough for Prototype)

| Dataset | Source | Priority |
|---------|--------|----------|
| 🇱🇸 Boundaries | Lesotho official/UN (HDX COD-AB FAO/MLGCA 2019) | 🔴 |
| 🛣️ Roads | OpenStreetMap (Geofabrik 119MB PBF, HOTOSM) | 🔴 |
| 🏘️ Settlements | OSM/WorldPop | 🔴 |
| 👥 Population | WorldPop 100m (1.90MB) | 🔴 |
| 🛰️ Sentinel-1 | Copernicus (SAR, through clouds/night) | 🔴 |
| 🛰️ Sentinel-2 | Copernicus (optical, vegetation, burn scars) | 🔴 |
| 🔥 Active fires | NASA FIRMS VIIRS 375m | 🔴 |
| 🌧️ Rainfall | CHIRPS 0.05° 1981-present | 🔴 |
| 🌡️ Weather | ERA5 + Open-Meteo | 🔴 |
| ⛰️ Elevation | Copernicus DEM 30m / SRTM | 🔴 |
| 🌊 Rivers/watersheds | HydroSHEDS + OSM | 🔴 |
| 🏥 Critical infrastructure | OSM + official | 🟠 |
| 🚔 Police incidents | LMPS (requires agreement) | 🟠 |
| 🚨 Emergency reports | Government (requires agreement) | 🟠 |
| 🛡️ Border data | Government (requires agreement) | 🟠 |
| 📹 CCTV | Authorised sources | 🟡 |
| 🚁 Drone feeds | Authorised operators | 🟡 |

## Architecture

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
```

## Data You DON'T Download From Internet

Most important distinction:

For **PoliceGuard**, eventually need authorized:
- Police incidents, crime reports, emergency calls, missing persons, stolen vehicles, station locations, patrol reports, case outcomes

For **LDF/DefenceGuard**, need authorised:
- Border infrastructure, official facilities, approved operational reports, emergency deployments, infrastructure incidents, disaster-response information

**Don't scrape or invent these.** Come from relevant authorities through authorised integration/data-sharing agreement.

## Value Proposition

1. **For Disaster Management Authority (DMA)**: Flood risk mapping using real CHIRPS + HydroRIVERS + Copernicus DEM + WorldPop exposure
2. **For Police (LMPS)**: Once integrated, "God's Eye View" of incidents + hazards + infrastructure
3. **For LDF**: Border monitoring with satellite change detection
4. **For Government**: AI layer on top of NSDI, not another map — leverages existing investment

## Next Steps

1. Run master_download.py to get all 11 MUST HAVE datasets
2. Load into PostGIS (scripts in docs/architecture.md)
3. Build flood risk demo: Maseru heavy rainfall case study
4. Cesium 3D demo with real Lesotho boundaries + population + roads
5. Present to NSDI stakeholders as AI augmentation, not replacement
