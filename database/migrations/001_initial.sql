CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  provenance TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic = 1),
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  landfall_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenario_track_points (
  scenario_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  wind_kph REAL NOT NULL CHECK (wind_kph >= 0),
  pressure_hpa REAL NOT NULL CHECK (pressure_hpa > 0),
  movement_kph REAL NOT NULL CHECK (movement_kph >= 0),
  movement_direction_deg REAL NOT NULL CHECK (movement_direction_deg BETWEEN 0 AND 360),
  PRIMARY KEY (scenario_id, sequence_no),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS impact_zones (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hazard TEXT NOT NULL CHECK (hazard IN ('wind', 'surge', 'rainfall', 'flood', 'access')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_km REAL NOT NULL CHECK (radius_km >= 0),
  description TEXT NOT NULL,
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS infrastructure_assets (
  id TEXT PRIMARY KEY,
  scenario_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hospital', 'school', 'shelter', 'power', 'water', 'road', 'bridge', 'communications')),
  district TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  population_served INTEGER CHECK (population_served IS NULL OR population_served >= 0),
  criticality TEXT NOT NULL CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
  vulnerability_score REAL NOT NULL CHECK (vulnerability_score BETWEEN 0 AND 1),
  notes TEXT NOT NULL,
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS weather_snapshots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source = 'open-meteo'),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS advisories (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'watch', 'warning')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  disclaimer TEXT NOT NULL CHECK (disclaimer = 'SIMULATED ADVISORY — NOT AN OFFICIAL WARNING'),
  generated_at TEXT NOT NULL,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id) ON DELETE CASCADE
);
