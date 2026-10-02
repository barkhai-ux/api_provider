# Private Lightsail comparison pilot

This pilot runs two API gateways side by side: the existing ArcGIS-backed
provider on port 8000 and a Mongolia OpenStreetMap stack on port 8001. The OSM
stack uses Nominatim for forward/reverse geocoding, OSRM for driving/walking
routes, and Planetiler plus TileServer GL for vector basemap tiles.

All published ports bind to `127.0.0.1`. Keep the Lightsail firewall closed to
ports 3000, 3001, 3210, 3211, 8000, 8001, and 8082; access them through SSH
port forwarding. The local `.env` on the server contains generated test
secrets and ArcGIS service credentials and must not be committed or shared.

## Prepare Mongolia data

Run from the repository root on the Lightsail server. The 59 MB Mongolia
snapshot used for this pilot is downloaded from Geofabrik
(<https://download.geofabrik.de/asia/mongolia-260929.osm.pbf>). Check
<https://download.geofabrik.de/asia/mongolia.html> for a newer extract before
refreshing the data.

```sh
mkdir -p deploy/aws-test/data
cd deploy/aws-test/data
curl -fL -o mongolia-latest.osm.pbf https://download.geofabrik.de/asia/mongolia-260929.osm.pbf
cd ../../..
```

Generate a MapLibre-compatible vector tile archive. Planetiler downloads its
OpenMapTiles profile assets during this first run and needs about 6 GB RAM for
this regional extract.

```sh
docker run --rm -e JAVA_TOOL_OPTIONS=-Xmx6g \
  -v "$PWD/deploy/aws-test/data:/data" ghcr.io/onthegomap/planetiler:latest \
  --osm-path=/data/mongolia-latest.osm.pbf --output=/data/mongolia.mbtiles --download --storage=mmap
```

Prepare separate car and foot routing graphs:

```sh
cd deploy/aws-test/data
cp mongolia-latest.osm.pbf mongolia-driving.osm.pbf
cp mongolia-latest.osm.pbf mongolia-walking.osm.pbf
cd ../../..
for profile in driving walking; do
  lua_profile=car
  [ "$profile" = walking ] && lua_profile=foot
  docker run --rm -v "$PWD/deploy/aws-test/data:/data" \
    ghcr.io/project-osrm/osrm-backend:v5.27.1 \
    osrm-extract -p "/opt/${lua_profile}.lua" "/data/mongolia-${profile}.osm.pbf"
  docker run --rm -v "$PWD/deploy/aws-test/data:/data" \
    ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-partition "/data/mongolia-${profile}.osrm"
  docker run --rm -v "$PWD/deploy/aws-test/data:/data" \
    ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-customize "/data/mongolia-${profile}.osrm"
done
```

## Start and compare

The server `.env` must include unique `API_KEY_PEPPER`, `GATEWAY_SECRET`,
`SITE_API_KEY`, `CONVEX_INSTANCE_SECRET`, and `NOMINATIM_PASSWORD` values,
plus the ArcGIS service URL and OAuth credentials for the baseline API. Keep
`ENVIRONMENT=development`, `SEED_DEMO_ACCOUNT=false`, and the site/API origins
on localhost for this SSH-only pilot.

```sh
docker compose -f docker-compose.yml -f deploy/aws-test/docker-compose.yml \
  --profile aws-test up -d --build
docker compose -f docker-compose.yml -f deploy/aws-test/docker-compose.yml ps
```

Nominatim imports the regional PBF on first start and can take several minutes.
Check `docker compose ... logs -f nominatim` until its health check passes.

From the local computer, open an SSH tunnel:

```sh
ssh -i ~/Downloads/LightsailDefaultKey-ap-southeast-2.pem -N \
  -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 \
  -L 8000:127.0.0.1:8000 -L 8001:127.0.0.1:8001 \
  -L 3210:127.0.0.1:3210 -L 3211:127.0.0.1:3211 \
  -L 8082:127.0.0.1:8082 ubuntu@LIGHTSAIL_IP
```

Use `http://localhost:3000` for the ArcGIS demo and `http://localhost:3001` for
the OSM demo. API probes are `/demo/geocode?q=Sukhbaatar Square` on ports 8000
and 8001; the OSM basemap viewer is at `http://localhost:8082`. Compare the
same search and route inputs on both APIs. OSM data requires visible OpenStreetMap
attribution in any public map display.

## Shut down

```sh
docker compose -f docker-compose.yml -f deploy/aws-test/docker-compose.yml \
  --profile aws-test down
```

This stops containers but retains OSM imports and route/tile files for another
session. `docker compose ... down -v` removes the Nominatim database volumes;
delete the Lightsail instance only when the test is finished and its files are
no longer needed.
