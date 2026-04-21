-- 001_initial_schema.sql
-- Schéma initial pour PMU Elite Punter

-- Table Courses
CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    heure TEXT,
    hippodrome TEXT,
    discipline TEXT,
    distance TEXT,
    statut TEXT,
    partants INTEGER,
    prix REAL,
    reunionNum TEXT,
    courseNum TEXT,
    corde TEXT,
    categorie TEXT,
    conditions TEXT,
    meteo TEXT,     
    type_pari TEXT,
    ordre_arrivee TEXT,
    rapports TEXT,
    UNIQUE(date, reunionNum, courseNum)
);

-- Table Participants
CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER,
    nom TEXT,
    numero INTEGER,
    sexe TEXT,
    age INTEGER,
    musique TEXT,
    gains REAL,
    driver TEXT,
    entraineur TEXT,
    proprietaire TEXT,
    ferrage TEXT,
    oeilleres TEXT,
    nb_courses INTEGER,
    nb_victoires INTEGER,
    nb_places INTEGER,
    cat_statut TEXT,
    cote_ref REAL,
    statut TEXT, 
    prediction_score REAL,
    classement INTEGER, 
    avis TEXT,
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(course_id, numero)
);

-- Indexation Participants
CREATE INDEX IF NOT EXISTS idx_participants_course_id ON participants(course_id);
CREATE INDEX IF NOT EXISTS idx_participants_cote_ref ON participants(cote_ref);
CREATE INDEX IF NOT EXISTS idx_participants_prediction_score ON participants(prediction_score);
CREATE INDEX IF NOT EXISTS idx_participants_entourage ON participants(driver, entraineur);
CREATE INDEX IF NOT EXISTS idx_courses_date ON courses(date);
CREATE INDEX IF NOT EXISTS idx_courses_discipline ON courses(discipline);

-- Table Paris Historique
CREATE TABLE IF NOT EXISTS paris_historique (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    course_id INTEGER,
    participant_id INTEGER,
    mise REAL,
    cote REAL,
    resultat TEXT,
    gain REAL,
    bankroll_avant REAL,
    bankroll_apres REAL,
    FOREIGN KEY(course_id) REFERENCES courses(id),
    FOREIGN KEY(participant_id) REFERENCES participants(id)
);

-- Table Shadow Bets
CREATE TABLE IF NOT EXISTS shadow_bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER,
    date TEXT,
    reunion TEXT,
    course TEXT,
    nom TEXT,
    mise REAL,
    cote REAL,
    proba REAL,
    edge REAL,
    resultat TEXT,
    gain REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table Portfolio
CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT UNIQUE,
    balance REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO portfolio (type, balance) VALUES ('shadow', 1000), ('reel', 1000);

-- Table Cotes Historique
CREATE TABLE IF NOT EXISTS cotes_historique (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER,
    cote REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE
);
