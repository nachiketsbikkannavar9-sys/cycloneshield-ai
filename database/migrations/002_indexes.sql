CREATE INDEX IF NOT EXISTS idx_scenarios_valid_from ON scenarios(valid_from);
CREATE INDEX IF NOT EXISTS idx_track_points_scenario ON scenario_track_points(scenario_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_impact_zones_scenario ON impact_zones(scenario_id, hazard);
CREATE INDEX IF NOT EXISTS idx_assets_district ON infrastructure_assets(district);
CREATE INDEX IF NOT EXISTS idx_assets_scenario ON infrastructure_assets(scenario_id);
CREATE INDEX IF NOT EXISTS idx_weather_snapshots_fetched ON weather_snapshots(fetched_at);
CREATE INDEX IF NOT EXISTS idx_simulations_scenario ON simulations(scenario_id, created_at);
CREATE INDEX IF NOT EXISTS idx_advisories_simulation ON advisories(simulation_id);
