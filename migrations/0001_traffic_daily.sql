-- XERAVION aggregate visitor analytics.
-- Stores daily counts only; no IP addresses, account IDs, or raw User-Agent strings.
CREATE TABLE IF NOT EXISTS traffic_daily (
  day TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'XX',
  traffic_class TEXT NOT NULL CHECK (traffic_class IN ('human', 'bot', 'unclassified')),
  page_views INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  PRIMARY KEY (day, country, traffic_class)
);

CREATE INDEX IF NOT EXISTS traffic_daily_day_idx
  ON traffic_daily (day);

CREATE INDEX IF NOT EXISTS traffic_daily_class_day_idx
  ON traffic_daily (traffic_class, day);
