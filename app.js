const $ = (selector) => document.querySelector(selector);

const previewCanvas = $("#preview");
const previewCtx = previewCanvas.getContext("2d");
const canvasWrap = $("#canvasWrap");
const mapView = $("#map");
const previewView = $("#previewView");
const tabRoute = $("#tabRoute");
const tabPreview = $("#tabPreview");
const playButton = $("#playButton");
const scrub = $("#scrub");
const timeLabel = $("#timeLabel");
const searchForm = $("#searchForm");
const searchInput = $("#searchInput");
const searchResults = $("#searchResults");
const waypointList = $("#waypointList");
const reverseButton = $("#reverseButton");
const clearButton = $("#clearButton");
const gpxFile = $("#gpxFile");
const routingSelect = $("#routingSelect");
const routeMeta = $("#routeMeta");
const durationInput = $("#durationInput");
const speedMeta = $("#speedMeta");
const aspectSelect = $("#aspectSelect");
const qualitySelect = $("#qualitySelect");
const fpsSelect = $("#fpsSelect");
const iconPicker = $("#iconPicker");
const iconColor = $("#iconColor");
const iconSize = $("#iconSize");
const iconSizeValue = $("#iconSizeValue");
const mapStyle = $("#mapStyle");
const mapDetail = $("#mapDetail");
const routeColor = $("#routeColor");
const lineWidth = $("#lineWidth");
const lineWidthValue = $("#lineWidthValue");
const cameraSelect = $("#cameraSelect");
const zoomInput = $("#zoomInput");
const zoomValue = $("#zoomValue");
const autoZoom = $("#autoZoom");
const rotateMap = $("#rotateMap");
const easeMotion = $("#easeMotion");
const showFullRoute = $("#showFullRoute");
const showEnds = $("#showEnds");
const showDistance = $("#showDistance");
const exportButton = $("#exportButton");
const exportProgress = $("#exportProgress");
const downloadLink = $("#downloadLink");
const statusText = $("#status");

const tileStyles = {
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    background: "#f2efe9",
    attribution: "© OpenStreetMap contributors",
  },
  humanitarian: {
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    background: "#f2efe9",
    attribution: "© OpenStreetMap contributors, HOT",
  },
  cyclosm: {
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    background: "#f2efe9",
    attribution: "© OpenStreetMap contributors, CyclOSM",
  },
  esriStreets: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    background: "#f3f1ec",
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  esriTopo: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    background: "#f3f1ec",
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  light: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
    background: "#e5e5e3",
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  dark: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
    background: "#343434",
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    background: "#1d2a1f",
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
};

const routingProfiles = {
  car: "routed-car",
  bike: "routed-bike",
  foot: "routed-foot",
};

// Zoom levels are expressed as they would look on a frame whose short side is 1080px,
// so the framing is identical in the preview and in every export resolution.
const REFERENCE_SIDE = 1080;
const PREVIEW_MAX_SIDE = 1440;
const TILE_CACHE_LIMIT = 900;

let waypoints = [];
let waypointMarkers = [];
let routeLine = null;
let route = null;
let gpxTrack = null;
let routeRequestId = 0;
let selectedIcon = "arrow";
let previewTime = 0;
let isPlaying = false;
let playStartedAt = 0;
let playStartTime = 0;
let drawQueued = false;
let isExporting = false;
let cancelExport = false;
let downloadUrl = null;

const tileCache = new Map();

/* ---------- Leaflet route editor ---------- */

const map = L.map(mapView, { zoomControl: true }).setView([50.45, 30.52], 6);
let baseLayer = null;

function setBaseLayer() {
  const style = tileStyles[mapStyle.value];
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(style.url, {
    subdomains: style.subdomains || "abc",
    maxNativeZoom: style.maxZoom,
    maxZoom: 19,
    attribution: style.attribution,
  }).addTo(map);
}

setBaseLayer();

map.on("click", (event) => {
  if (isExporting) return;
  if (gpxTrack) {
    setStatus("A GPX track is loaded. Press Clear to draw a new route.");
    return;
  }
  const waypoint = { lat: event.latlng.lat, lng: event.latlng.lng, name: formatCoords(event.latlng) };
  waypoints.push(waypoint);
  reverseGeocode(waypoint);
  onWaypointsChanged();
});

function formatCoords({ lat, lng }) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function setStatus(message) {
  statusText.textContent = message;
}

function renderWaypoints() {
  waypointMarkers.forEach((marker) => map.removeLayer(marker));
  waypointMarkers = [];
  waypointList.innerHTML = "";

  if (gpxTrack) {
    const item = document.createElement("li");
    item.innerHTML = `<span class="num">G</span><span class="name"></span><button type="button" title="Remove">✕</button>`;
    item.querySelector(".name").textContent = gpxTrack.name;
    item.querySelector("button").addEventListener("click", clearRoute);
    waypointList.append(item);
    return;
  }

  waypoints.forEach((waypoint, index) => {
    const marker = L.marker([waypoint.lat, waypoint.lng], {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: `<div class="wp-marker">${index + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(map);

    marker.on("dragend", () => {
      const latlng = marker.getLatLng();
      waypoint.lat = latlng.lat;
      waypoint.lng = latlng.lng;
      waypoint.name = formatCoords(latlng);
      reverseGeocode(waypoint);
      onWaypointsChanged();
    });
    marker.on("click", () => removeWaypoint(index));
    waypointMarkers.push(marker);

    const item = document.createElement("li");
    item.innerHTML = `<span class="num">${index + 1}</span><span class="name"></span><button type="button" title="Remove">✕</button>`;
    item.querySelector(".name").textContent = waypoint.name;
    item.querySelector(".name").title = waypoint.name;
    item.querySelector("button").addEventListener("click", () => removeWaypoint(index));
    waypointList.append(item);
  });
}

function removeWaypoint(index) {
  if (isExporting) return;
  waypoints.splice(index, 1);
  onWaypointsChanged();
}

function onWaypointsChanged() {
  renderWaypoints();
  updateRoute();
}

async function reverseGeocode(waypoint) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${waypoint.lat}&lon=${waypoint.lng}&accept-language=${navigator.language}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.display_name || !waypoints.includes(waypoint)) return;
    waypoint.name = shortPlaceName(data.display_name);
    renderWaypoints();
  } catch {
    // Coordinates remain as the name.
  }
}

function shortPlaceName(displayName) {
  return displayName.split(",").slice(0, 3).join(",").trim();
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  searchResults.innerHTML = "";
  setStatus("Searching…");
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}&accept-language=${navigator.language}`;
    const results = await (await fetch(url)).json();
    if (!results.length) {
      setStatus("Nothing found.");
      return;
    }
    setStatus(`${results.length} result${results.length > 1 ? "s" : ""}. Pick one to add it to the route.`);
    results.forEach((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = result.display_name;
      button.addEventListener("click", () => {
        if (gpxTrack) clearRoute();
        const waypoint = { lat: Number(result.lat), lng: Number(result.lon), name: shortPlaceName(result.display_name) };
        waypoints.push(waypoint);
        searchResults.innerHTML = "";
        searchInput.value = "";
        onWaypointsChanged();
        if (waypoints.length === 1) map.setView([waypoint.lat, waypoint.lng], 13);
      });
      searchResults.append(button);
    });
  } catch (error) {
    setStatus(`Search failed: ${error.message}`);
  }
});

reverseButton.addEventListener("click", () => {
  if (gpxTrack) {
    gpxTrack.latlngs.reverse();
    setRoute(gpxTrack.latlngs);
    return;
  }
  waypoints.reverse();
  onWaypointsChanged();
});

clearButton.addEventListener("click", clearRoute);

function clearRoute() {
  if (isExporting) return;
  waypoints = [];
  gpxTrack = null;
  onWaypointsChanged();
}

routingSelect.addEventListener("change", updateRoute);

gpxFile.addEventListener("change", async () => {
  const file = gpxFile.files[0];
  gpxFile.value = "";
  if (!file) return;

  const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
  let points = [...xml.querySelectorAll("trkpt")];
  if (!points.length) points = [...xml.querySelectorAll("rtept")];
  if (!points.length) points = [...xml.querySelectorAll("wpt")];
  const latlngs = points
    .map((point) => [Number(point.getAttribute("lat")), Number(point.getAttribute("lon"))])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  if (latlngs.length < 2) {
    setStatus("This GPX file has no track points.");
    return;
  }

  waypoints = [];
  gpxTrack = { name: file.name, latlngs };
  renderWaypoints();
  setRoute(latlngs);
  map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
});

async function updateRoute() {
  if (gpxTrack) {
    setRoute(gpxTrack.latlngs);
    return;
  }

  const requestId = ++routeRequestId;
  if (waypoints.length < 2) {
    setRoute(null);
    setStatus(waypoints.length ? "Add one more point." : "Add at least two points.");
    return;
  }

  const mode = routingSelect.value;
  if (mode === "straight") {
    setRoute(waypoints.map((waypoint) => [waypoint.lat, waypoint.lng]));
    return;
  }

  setStatus("Building route…");
  try {
    const coords = waypoints.map((waypoint) => `${waypoint.lng.toFixed(6)},${waypoint.lat.toFixed(6)}`).join(";");
    const url = `https://routing.openstreetmap.de/${routingProfiles[mode]}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const data = await (await fetch(url)).json();
    if (requestId !== routeRequestId) return;
    if (data.code !== "Ok" || !data.routes?.length) throw new Error(data.message || data.code || "no route");
    setRoute(data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]));
  } catch (error) {
    if (requestId !== routeRequestId) return;
    setRoute(waypoints.map((waypoint) => [waypoint.lat, waypoint.lng]));
    setStatus(`Routing failed (${error.message}). Using straight lines.`);
  }
}

function setRoute(latlngs) {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  route = latlngs && latlngs.length >= 2 ? buildRoute(latlngs) : null;
  if (route) {
    routeLine = L.polyline(latlngs, { color: routeColor.value, weight: 5, opacity: 0.85 }).addTo(map);
    setStatus("Route ready. Open Preview or export the video.");
  }

  exportButton.disabled = !route || isExporting;
  updateMeta();
  requestDraw();
}

/* ---------- Route geometry (normalized Web Mercator, 0..1) ---------- */

function project(lat, lng) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

function haversineKm([lat1, lng1], [lat2, lng2]) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildRoute(latlngs) {
  const points = [];
  const cumulative = [];
  const kmCumulative = [];
  let km = 0;
  let length = 0;

  latlngs.forEach((latlng, index) => {
    const point = project(latlng[0], latlng[1]);
    const previous = points[points.length - 1];
    if (previous) {
      const step = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (step === 0) return;
      length += step;
      km += haversineKm(latlngs[index - 1], latlng);
    }
    points.push(point);
    cumulative.push(length);
    kmCumulative.push(km);
  });

  if (points.length < 2) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    points,
    cumulative,
    kmCumulative,
    length,
    km,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function pointAt(distance) {
  const { points, cumulative, kmCumulative, length } = route;
  const s = Math.max(0, Math.min(length, distance));
  let low = 0;
  let high = cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] <= s) low = mid;
    else high = mid;
  }
  const segment = cumulative[high] - cumulative[low] || 1;
  const k = (s - cumulative[low]) / segment;
  return {
    x: points[low].x + (points[high].x - points[low].x) * k,
    y: points[low].y + (points[high].y - points[low].y) * k,
    index: low,
    km: kmCumulative[low] + (kmCumulative[high] - kmCumulative[low]) * k,
  };
}

function directionAt(distance, window) {
  const behind = pointAt(distance - window);
  const ahead = pointAt(distance + window);
  const dx = ahead.x - behind.x;
  const dy = ahead.y - behind.y;
  if (dx === 0 && dy === 0) return null;
  return Math.atan2(dy, dx);
}

/* ---------- Camera ---------- */

function getDuration() {
  const value = Number(durationInput.value);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 600) : 10;
}

function getOutputSize(shortSide) {
  const [a, b] = aspectSelect.value.split(":").map(Number);
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  return a >= b
    ? { width: even((shortSide * a) / b), height: even(shortSide) }
    : { width: even(shortSide), height: even((shortSide * b) / a) };
}

function easeInOut(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

function smoothstep(u) {
  const k = Math.max(0, Math.min(1, u));
  return k * k * (3 - 2 * k);
}

function getFitZoom(width, height) {
  const scale = Math.min(width, height) / REFERENCE_SIDE;
  const padding = Math.min(width, height) * 0.12;
  const spanX = Math.max(route.maxX - route.minX, 1e-9);
  const spanY = Math.max(route.maxY - route.minY, 1e-9);
  const worldPx = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  return Math.min(18, Math.log2(worldPx / (256 * scale)));
}

function getFollowZoom(width, height) {
  if (!autoZoom.checked) return Number(zoomInput.value);
  return Math.max(3, Math.min(17.5, getFitZoom(width, height) + 2));
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function getFrameState(time, width, height) {
  const duration = getDuration();
  const u = Math.max(0, Math.min(1, time / duration));
  const progress = easeMotion.checked ? easeInOut(u) : u;
  const distance = progress * route.length;
  const position = pointAt(distance);
  const scale = Math.min(width, height) / REFERENCE_SIDE;

  const overviewZoom = getFitZoom(width, height);
  const followZoom = getFollowZoom(width, height);
  const mode = cameraSelect.value;

  let follow = 1;
  if (mode === "overview") {
    follow = 0;
  } else if (mode === "cinematic") {
    const edge = Math.min(0.18, 2 / duration);
    follow = Math.min(smoothstep(u / edge), smoothstep((1 - u) / edge));
  }

  const zoom = overviewZoom + (followZoom - overviewZoom) * follow;
  const worldPx = 256 * 2 ** zoom * scale;
  const overviewCenter = { x: (route.minX + route.maxX) / 2, y: (route.minY + route.maxY) / 2 };

  let rotation = 0;
  if (rotateMap.checked && follow > 0) {
    const followWorldPx = 256 * 2 ** followZoom * scale;
    const heading = directionAt(distance, (220 * scale) / followWorldPx);
    if (heading !== null) rotation = normalizeAngle(-(heading + Math.PI / 2)) * follow;
  }

  const iconScale = Number(iconSize.value) / 100;
  const iconHeading = directionAt(distance, (16 * scale * iconScale) / worldPx);

  return {
    scale,
    worldPx,
    rotation,
    position,
    distance,
    iconHeading: iconHeading ?? -Math.PI / 2,
    center: {
      x: overviewCenter.x + (position.x - overviewCenter.x) * follow,
      y: overviewCenter.y + (position.y - overviewCenter.y) * follow,
    },
    anchor: {
      x: width / 2,
      y: height * (0.5 + (rotateMap.checked ? 0.14 * follow : 0)),
    },
  };
}

/* ---------- Tiles ---------- */

function tileUrl(style, z, x, y) {
  const subdomains = style.subdomains;
  const s = subdomains ? subdomains[(x + y) % subdomains.length] : "";
  return style.url
    .replace("{s}", s)
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y)
    .replace("{r}", "@2x");
}

function getTileSize(style) {
  return style.url.includes("{r}") ? 512 : 256;
}

function getTile(style, z, x, y, create = true) {
  const url = tileUrl(style, z, x, y);
  let tile = tileCache.get(url);
  if (tile) {
    tileCache.delete(url);
    tileCache.set(url, tile);
    return tile;
  }
  if (!create) return null;

  const image = new Image();
  image.crossOrigin = "anonymous";
  tile = { image, ready: false, failed: false };
  tile.promise = new Promise((resolve) => {
    image.onload = () => {
      tile.ready = true;
      resolve();
      requestDraw();
    };
    image.onerror = () => {
      tile.failed = true;
      resolve();
    };
  });
  image.src = url;
  tileCache.set(url, tile);

  while (tileCache.size > TILE_CACHE_LIMIT) {
    tileCache.delete(tileCache.keys().next().value);
  }
  return tile;
}

// Lists the tiles covering the frame, in the rotated local space around the anchor.
function getVisibleTiles(frame, width, height, style) {
  const tileSize = getTileSize(style);
  // Negative detail uses a coarser tile level, so labels stay readable at 4K.
  const detail = Number(mapDetail.value);
  const tileZoom = Math.max(0, Math.min(style.maxZoom, Math.round(Math.log2(frame.worldPx / tileSize) + detail)));
  const count = 2 ** tileZoom;

  let left = -frame.anchor.x;
  let right = width - frame.anchor.x;
  let top = -frame.anchor.y;
  let bottom = height - frame.anchor.y;
  if (frame.rotation !== 0) {
    const radius = Math.hypot(Math.max(-left, right), Math.max(-top, bottom));
    left = -radius;
    right = radius;
    top = -radius;
    bottom = radius;
  }

  const toTile = (local, center) => (center + local / frame.worldPx) * count;
  const x0 = Math.floor(toTile(left, frame.center.x));
  const x1 = Math.floor(toTile(right, frame.center.x));
  const y0 = Math.max(0, Math.floor(toTile(top, frame.center.y)));
  const y1 = Math.min(count - 1, Math.floor(toTile(bottom, frame.center.y)));

  const tiles = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      tiles.push({ z: tileZoom, x, y, wrappedX: ((x % count) + count) % count, count });
    }
  }
  return tiles;
}

function drawTiles(ctx, frame, width, height, style, pending) {
  const tileSize = getTileSize(style);
  const tiles = getVisibleTiles(frame, width, height, style);

  tiles.forEach(({ z, x, y, wrappedX, count }) => {
    const left = Math.floor((x / count - frame.center.x) * frame.worldPx);
    const top = Math.floor((y / count - frame.center.y) * frame.worldPx);
    const right = Math.floor(((x + 1) / count - frame.center.x) * frame.worldPx);
    const bottom = Math.floor(((y + 1) / count - frame.center.y) * frame.worldPx);
    const overlap = frame.rotation !== 0 ? 0.6 : 0;

    const tile = getTile(style, z, wrappedX, y);
    if (tile.ready) {
      ctx.drawImage(tile.image, left - overlap, top - overlap, right - left + overlap * 2, bottom - top + overlap * 2);
      return;
    }
    if (!tile.failed) pending?.push(tile.promise);

    // While the tile loads (preview only), stretch a lower zoom tile that is already cached.
    for (let up = 1; up <= 5 && z - up >= 0; up += 1) {
      const parent = getTile(style, z - up, wrappedX >> up, y >> up, false);
      if (!parent?.ready) continue;
      const part = tileSize / 2 ** up;
      const sx = (wrappedX - ((wrappedX >> up) << up)) * part;
      const sy = (y - ((y >> up) << up)) * part;
      ctx.drawImage(parent.image, sx, sy, part, part, left - overlap, top - overlap, right - left + overlap * 2, bottom - top + overlap * 2);
      break;
    }
  });
}

/* ---------- Frame rendering ---------- */

function toLocal(point, frame) {
  return {
    x: (point.x - frame.center.x) * frame.worldPx,
    y: (point.y - frame.center.y) * frame.worldPx,
  };
}

function tracePath(ctx, frame, endIndex, endPoint) {
  const { points } = route;
  ctx.beginPath();
  let last = null;
  for (let i = 0; i <= endIndex; i += 1) {
    const local = toLocal(points[i], frame);
    if (last && Math.abs(local.x - last.x) < 0.75 && Math.abs(local.y - last.y) < 0.75) continue;
    if (last) ctx.lineTo(local.x, local.y);
    else ctx.moveTo(local.x, local.y);
    last = local;
  }
  if (endPoint) {
    const local = toLocal(endPoint, frame);
    ctx.lineTo(local.x, local.y);
  }
}

function strokeRoute(ctx, frame, endIndex, endPoint, color, alpha) {
  const width = 7 * frame.scale * (Number(lineWidth.value) / 100);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = alpha;
  tracePath(ctx, frame, endIndex, endPoint);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = width + 4 * frame.scale;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function drawEndMarker(ctx, frame, point, kind) {
  const local = toLocal(point, frame);
  const radius = 10 * frame.scale * Math.max(0.8, Number(lineWidth.value) / 100);
  ctx.save();
  ctx.translate(local.x, local.y);
  ctx.rotate(-frame.rotation);
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 6 * frame.scale;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 3 * frame.scale, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  if (kind === "start") {
    ctx.fillStyle = "#1db954";
    ctx.fill();
  } else {
    ctx.save();
    ctx.clip();
    const cell = (radius * 2) / 4;
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        ctx.fillStyle = (row + col) % 2 ? "#fff" : "#111";
        ctx.fillRect(-radius + col * cell, -radius + row * cell, cell, cell);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => {
    const c = (value >> shift) & 255;
    return Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

// All icons are drawn pointing up (-y) and centered on the route position.
function drawIcon(ctx, type, size, color, scale) {
  ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
  ctx.shadowBlur = 10 * scale;
  ctx.shadowOffsetY = 3 * scale;
  const outline = Math.max(1.5, size * 0.06);

  if (type === "arrow") {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.5);
    ctx.lineTo(size * 0.4, size * 0.45);
    ctx.lineTo(0, size * 0.24);
    ctx.lineTo(-size * 0.4, size * 0.45);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = outline * 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  if (type === "dot") {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = shade(color, 0.55);
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  if (type === "car") {
    const w = size * 0.5;
    const h = size;
    // Wheels
    ctx.fillStyle = "#1b1b1b";
    [-0.3, 0.3].forEach((wy) => {
      roundRect(ctx, -w / 2 - size * 0.035, h * wy - h * 0.09, size * 0.07, h * 0.18, size * 0.02);
      ctx.fill();
      roundRect(ctx, w / 2 - size * 0.035, h * wy - h * 0.09, size * 0.07, h * 0.18, size * 0.02);
      ctx.fill();
    });
    // Body
    roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.32);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = outline * 0.6;
    ctx.strokeStyle = shade(color, -0.35);
    ctx.stroke();
    // Mirrors
    ctx.fillStyle = shade(color, -0.2);
    roundRect(ctx, -w / 2 - size * 0.07, -h * 0.17, size * 0.08, size * 0.05, size * 0.02);
    ctx.fill();
    roundRect(ctx, w / 2 - size * 0.01, -h * 0.17, size * 0.08, size * 0.05, size * 0.02);
    ctx.fill();
    // Windshield
    ctx.fillStyle = "#1f2a33";
    ctx.beginPath();
    ctx.moveTo(-w * 0.4, -h * 0.12);
    ctx.lineTo(w * 0.4, -h * 0.12);
    ctx.lineTo(w * 0.32, -h * 0.25);
    ctx.quadraticCurveTo(0, -h * 0.29, -w * 0.32, -h * 0.25);
    ctx.closePath();
    ctx.fill();
    // Roof
    roundRect(ctx, -w * 0.38, -h * 0.1, w * 0.76, h * 0.34, w * 0.12);
    ctx.fillStyle = shade(color, 0.15);
    ctx.fill();
    // Rear window
    ctx.fillStyle = "#1f2a33";
    ctx.beginPath();
    ctx.moveTo(-w * 0.36, h * 0.26);
    ctx.lineTo(w * 0.36, h * 0.26);
    ctx.lineTo(w * 0.3, h * 0.35);
    ctx.lineTo(-w * 0.3, h * 0.35);
    ctx.closePath();
    ctx.fill();
    // Headlights and tail lights
    ctx.fillStyle = "#fff6c2";
    roundRect(ctx, -w * 0.4, -h * 0.49, w * 0.22, h * 0.05, size * 0.02);
    ctx.fill();
    roundRect(ctx, w * 0.18, -h * 0.49, w * 0.22, h * 0.05, size * 0.02);
    ctx.fill();
    ctx.fillStyle = "#e0161b";
    roundRect(ctx, -w * 0.4, h * 0.445, w * 0.2, h * 0.04, size * 0.02);
    ctx.fill();
    roundRect(ctx, w * 0.2, h * 0.445, w * 0.2, h * 0.04, size * 0.02);
    ctx.fill();
    return;
  }

  if (type === "moto") {
    const h = size;
    // Wheels
    ctx.fillStyle = "#1b1b1b";
    roundRect(ctx, -size * 0.06, -h * 0.5, size * 0.12, h * 0.3, size * 0.06);
    ctx.fill();
    roundRect(ctx, -size * 0.07, h * 0.18, size * 0.14, h * 0.32, size * 0.07);
    ctx.fill();
    ctx.shadowColor = "transparent";
    // Body and tank
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.13, h * 0.26, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = outline * 0.6;
    ctx.strokeStyle = shade(color, -0.35);
    ctx.stroke();
    // Handlebar
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineCap = "round";
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    ctx.moveTo(-size * 0.26, -h * 0.2);
    ctx.quadraticCurveTo(0, -h * 0.25, size * 0.26, -h * 0.2);
    ctx.stroke();
    // Headlight
    ctx.fillStyle = "#fff6c2";
    ctx.beginPath();
    ctx.arc(0, -h * 0.3, size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // Rider shoulders and helmet
    ctx.beginPath();
    ctx.ellipse(0, h * 0.06, size * 0.2, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#2b2f36";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, h * 0.02, size * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = shade(color, -0.25);
    ctx.fill();
    ctx.lineWidth = size * 0.025;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}

function formatKm(km) {
  if (km < 10) return km.toFixed(2);
  if (km < 100) return km.toFixed(1);
  return Math.round(km).toLocaleString("en-US");
}

// Distance counter in the bottom-left corner; the pill width is fixed by the route total so it does not jitter.
function drawDistance(ctx, height, km, scale) {
  const margin = 28 * scale;
  const valueSize = 44 * scale;
  const unitSize = 22 * scale;
  const padX = 22 * scale;
  const pillHeight = 72 * scale;
  const valueFont = `800 ${Math.round(valueSize)}px Inter, system-ui, -apple-system, sans-serif`;
  const unitFont = `700 ${Math.round(unitSize)}px Inter, system-ui, -apple-system, sans-serif`;

  ctx.save();
  ctx.font = valueFont;
  const template = formatKm(route.km).replace(/\d/g, "8");
  const valueWidth = ctx.measureText(template).width;
  ctx.font = unitFont;
  const unitWidth = ctx.measureText("km").width;
  const gap = 8 * scale;
  const pillWidth = padX * 2 + valueWidth + gap + unitWidth;
  const x = margin;
  const y = height - margin - pillHeight;

  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 14 * scale;
  roundRect(ctx, x, y, pillWidth, pillHeight, pillHeight / 2);
  ctx.fillStyle = "rgba(17, 22, 21, 0.82)";
  ctx.fill();
  ctx.shadowColor = "transparent";

  const baseline = y + pillHeight / 2 + valueSize * 0.36;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.font = valueFont;
  ctx.fillStyle = "#fff";
  ctx.fillText(formatKm(km), x + padX + valueWidth, baseline);
  ctx.textAlign = "left";
  ctx.font = unitFont;
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillText("km", x + padX + valueWidth + gap, baseline);
  ctx.restore();
}

function drawAttribution(ctx, width, height, style, scale) {
  ctx.save();
  ctx.font = `${Math.round(13 * scale)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const x = width - 12 * scale;
  const y = height - 10 * scale;
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.strokeText(style.attribution, x, y);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(style.attribution, x, y);
  ctx.restore();
}

function renderFrame(ctx, width, height, time, pending) {
  const style = tileStyles[mapStyle.value];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);

  if (!route) {
    ctx.fillStyle = "#6b7671";
    ctx.font = `${Math.round(height * 0.04)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Build a route first", width / 2, height / 2);
    ctx.restore();
    return;
  }

  const frame = getFrameState(time, width, height);
  ctx.translate(frame.anchor.x, frame.anchor.y);
  ctx.rotate(frame.rotation);

  ctx.imageSmoothingQuality = "high";
  drawTiles(ctx, frame, width, height, style, pending);

  const color = routeColor.value;
  const lastIndex = route.points.length - 1;
  if (showFullRoute.checked) strokeRoute(ctx, frame, lastIndex, null, color, 0.5);
  strokeRoute(ctx, frame, frame.position.index, frame.position, color, 1);

  if (showEnds.checked) {
    drawEndMarker(ctx, frame, route.points[lastIndex], "finish");
    drawEndMarker(ctx, frame, route.points[0], "start");
  }

  const local = toLocal(frame.position, frame);
  const size = 46 * frame.scale * (Number(iconSize.value) / 100);
  ctx.save();
  ctx.translate(local.x, local.y);
  ctx.rotate(frame.iconHeading + Math.PI / 2);
  drawIcon(ctx, selectedIcon, size, iconColor.value, frame.scale);
  ctx.restore();

  ctx.restore();
  if (showDistance.checked) drawDistance(ctx, height, frame.position.km, frame.scale);
  drawAttribution(ctx, width, height, style, frame.scale);
}

/* ---------- Preview ---------- */

function fitPreview() {
  const { width, height } = getOutputSize(1000);
  const boxWidth = canvasWrap.clientWidth;
  const boxHeight = canvasWrap.clientHeight;
  if (!boxWidth || !boxHeight) return;

  const cssScale = Math.min(boxWidth / width, boxHeight / height);
  const cssWidth = Math.floor(width * cssScale);
  const cssHeight = Math.floor(height * cssScale);
  previewCanvas.style.width = `${cssWidth}px`;
  previewCanvas.style.height = `${cssHeight}px`;

  const exportSide = Number(qualitySelect.value);
  const shortCss = Math.min(cssWidth, cssHeight);
  const shortSide = Math.min(exportSide, PREVIEW_MAX_SIDE, Math.round(shortCss * (window.devicePixelRatio || 1)));
  const size = getOutputSize(shortSide);
  if (previewCanvas.width !== size.width || previewCanvas.height !== size.height) {
    previewCanvas.width = size.width;
    previewCanvas.height = size.height;
  }
  requestDraw();
}

function requestDraw() {
  if (drawQueued || previewView.hidden) return;
  drawQueued = true;
  requestAnimationFrame(drawPreview);
}

function drawPreview() {
  drawQueued = false;
  const duration = getDuration();
  if (isPlaying) {
    previewTime = playStartTime + (performance.now() - playStartedAt) / 1000;
    if (previewTime >= duration) {
      previewTime = duration;
      setPlaying(false);
    }
  }
  previewTime = Math.min(previewTime, duration);
  scrub.value = String(Math.round((previewTime / duration) * 1000));
  timeLabel.textContent = `${previewTime.toFixed(1)}s`;
  renderFrame(previewCtx, previewCanvas.width, previewCanvas.height, previewTime);
  if (isPlaying) requestDraw();
}

function setPlaying(playing) {
  isPlaying = playing;
  playButton.textContent = playing ? "Pause" : "Play";
  if (playing) {
    if (previewTime >= getDuration()) previewTime = 0;
    playStartTime = previewTime;
    playStartedAt = performance.now();
    requestDraw();
  }
}

playButton.addEventListener("click", () => setPlaying(!isPlaying));

scrub.addEventListener("input", () => {
  setPlaying(false);
  previewTime = (Number(scrub.value) / 1000) * getDuration();
  requestDraw();
});

function showTab(name) {
  const preview = name === "preview";
  tabRoute.classList.toggle("is-active", !preview);
  tabPreview.classList.toggle("is-active", preview);
  mapView.hidden = preview;
  previewView.hidden = !preview;
  if (preview) {
    fitPreview();
  } else {
    setPlaying(false);
    map.invalidateSize();
  }
}

tabRoute.addEventListener("click", () => showTab("route"));
tabPreview.addEventListener("click", () => showTab("preview"));
window.addEventListener("resize", () => {
  if (!previewView.hidden) fitPreview();
});

/* ---------- Settings ---------- */

function updateMeta() {
  if (!route) {
    routeMeta.textContent = "No route yet";
    speedMeta.textContent = "";
    zoomValue.textContent = autoZoom.checked ? "auto" : Number(zoomInput.value).toFixed(2);
    return;
  }

  const duration = getDuration();
  const speed = route.km / (duration / 3600);
  routeMeta.textContent = `Route length: ${route.km < 10 ? route.km.toFixed(2) : route.km.toFixed(1)} km`;
  speedMeta.textContent = `Speed in video: ${Math.round(speed).toLocaleString()} km/h (${(route.km / duration).toFixed(route.km / duration < 1 ? 3 : 1)} km per second)`;

  const { width, height } = getOutputSize(REFERENCE_SIDE);
  const followZoom = getFollowZoom(width, height);
  if (autoZoom.checked) zoomInput.value = String(followZoom);
  zoomValue.textContent = `${autoZoom.checked ? "auto " : ""}${followZoom.toFixed(2)}`;
}

function onSettingChanged() {
  updateMeta();
  requestDraw();
}

durationInput.addEventListener("input", onSettingChanged);
aspectSelect.addEventListener("change", () => {
  updateMeta();
  fitPreview();
});
qualitySelect.addEventListener("change", fitPreview);
[iconColor, routeColor, lineWidth, iconSize, cameraSelect, rotateMap, easeMotion, showFullRoute, showEnds, showDistance, zoomInput].forEach(
  (input) => input.addEventListener("input", onSettingChanged),
);

iconSize.addEventListener("input", () => {
  iconSizeValue.textContent = `${iconSize.value}%`;
});
lineWidth.addEventListener("input", () => {
  lineWidthValue.textContent = `${lineWidth.value}%`;
});
routeColor.addEventListener("input", () => {
  routeLine?.setStyle({ color: routeColor.value });
});

autoZoom.addEventListener("change", () => {
  zoomInput.disabled = autoZoom.checked;
  onSettingChanged();
});

mapDetail.addEventListener("change", requestDraw);

mapStyle.addEventListener("change", () => {
  setBaseLayer();
  requestDraw();
});

iconPicker.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-icon]");
  if (!button) return;
  selectedIcon = button.dataset.icon;
  iconPicker.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
  requestDraw();
});

/* ---------- Export ---------- */

async function pickEncoderConfig(width, height, fps) {
  const bitrate = Math.min(90_000_000, Math.round(width * height * fps * 0.18));
  const candidates = [
    { codec: "avc1.640033", muxCodec: "avc" },
    { codec: "avc1.640034", muxCodec: "avc" },
    { codec: "avc1.64003C", muxCodec: "avc" },
    { codec: "avc1.4d0033", muxCodec: "avc" },
    { codec: "avc1.42003e", muxCodec: "avc" },
    { codec: "vp09.00.51.08", muxCodec: "vp9" },
    { codec: "av01.0.12M.08", muxCodec: "av1" },
  ];

  for (const candidate of candidates) {
    const config = {
      codec: candidate.codec,
      width,
      height,
      bitrate,
      framerate: fps,
      ...(candidate.muxCodec === "avc" ? { avc: { format: "avc" } } : {}),
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return { config, muxCodec: candidate.muxCodec, bitrate };
    } catch {
      // Try the next codec.
    }
  }
  return null;
}

async function exportVideo() {
  if (isExporting) {
    cancelExport = true;
    return;
  }
  if (!route) return;
  if (!("VideoEncoder" in window) || !window.Mp4Muxer) {
    setStatus("This browser has no WebCodecs video encoder. Use a current Chrome or Edge.");
    return;
  }

  const fps = Number(fpsSelect.value);
  const duration = getDuration();
  const { width, height } = getOutputSize(Number(qualitySelect.value));
  const choice = await pickEncoderConfig(width, height, fps);
  if (!choice) {
    setStatus(`No encoder supports ${width}x${height}. Try a lower resolution.`);
    return;
  }

  isExporting = true;
  cancelExport = false;
  setPlaying(false);
  exportButton.textContent = "Cancel export";
  exportProgress.hidden = false;
  exportProgress.value = 0;
  downloadLink.hidden = true;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: choice.muxCodec, width, height, frameRate: fps },
    fastStart: "in-memory",
  });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error;
    },
  });
  encoder.configure(choice.config);

  const frameCount = Math.max(2, Math.round(duration * fps));
  const frameDuration = 1e6 / fps;
  const startedAt = performance.now();

  try {
    for (let i = 0; i < frameCount; i += 1) {
      if (cancelExport) throw new Error("Export cancelled.");
      if (encodeError) throw encodeError;

      const time = (i / (frameCount - 1)) * duration;
      // Render until every tile of the frame is loaded; failed tiles do not block.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const pending = [];
        renderFrame(ctx, width, height, time, pending);
        if (!pending.length) break;
        await Promise.all(pending);
      }
      prefetchTiles(Math.min(duration, time + 0.5), width, height);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameDuration),
        duration: Math.round(frameDuration),
      });
      encoder.encode(videoFrame, { keyFrame: i % (fps * 2) === 0 });
      videoFrame.close();

      while (encoder.encodeQueueSize > 6) {
        await new Promise((resolve) => setTimeout(resolve, 4));
      }

      exportProgress.value = (i + 1) / frameCount;
      if (i % 5 === 0) {
        setStatus(`Rendering ${width}x${height} @ ${fps} fps: frame ${i + 1} of ${frameCount}.`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    await encoder.flush();
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    downloadUrl = URL.createObjectURL(blob);
    downloadLink.href = downloadUrl;
    downloadLink.download = `mapvis-${aspectSelect.value.replace(":", "x")}-${height}p.mp4`;
    downloadLink.hidden = false;
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    setStatus(
      `Export ready: ${width}x${height}, ${duration}s, ${fps} fps, ${choice.config.codec.split(".")[0].toUpperCase()} ~${Math.round(choice.bitrate / 1e6)} Mbps, ${(blob.size / 1e6).toFixed(1)} MB. Rendered in ${seconds}s.`,
    );
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    if (encoder.state !== "closed") encoder.close();
    isExporting = false;
    exportButton.textContent = "Export video";
    exportButton.disabled = !route;
    exportProgress.hidden = true;
  }
}

function prefetchTiles(time, width, height) {
  const style = tileStyles[mapStyle.value];
  const frame = getFrameState(time, width, height);
  getVisibleTiles(frame, width, height, style).forEach(({ z, wrappedX, y }) => getTile(style, z, wrappedX, y));
}

exportButton.addEventListener("click", exportVideo);

renderWaypoints();
updateMeta();
