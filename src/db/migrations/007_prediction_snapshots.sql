CREATE TABLE IF NOT EXISTS prediction_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    participant_id INTEGER NOT NULL,
    horse_number INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    course_date TEXT NOT NULL,
    scheduled_time TEXT,
    discipline TEXT,
    hippodrome TEXT,
    distance TEXT,
    captured_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'pmu-api',
    model_version TEXT NOT NULL,
    prediction_score REAL NOT NULL,
    prediction_rank INTEGER NOT NULL,
    odds_at_prediction REAL,
    market_probability REAL,
    market_rank INTEGER,
    has_form INTEGER NOT NULL DEFAULT 0,
    has_driver INTEGER NOT NULL DEFAULT 0,
    outcome_rank INTEGER, -- 0 = non-gagnant confirmé, NULL = résultat non réglé
    official_arrival TEXT,
    official_payout REAL,
    reports_json TEXT,
    settled_at TEXT,
    UNIQUE(course_id, horse_number),
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_course_date
    ON prediction_snapshots(course_date, course_id);
CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_settled
    ON prediction_snapshots(settled_at, course_date);
