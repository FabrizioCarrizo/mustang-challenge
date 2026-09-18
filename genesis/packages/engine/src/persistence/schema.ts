export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL,
  kind TEXT NOT NULL,
  agent_id INTEGER,
  target_id INTEGER,
  x INTEGER,
  y INTEGER,
  importance REAL NOT NULL DEFAULT 3,
  label TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_tick ON events(tick);
CREATE INDEX IF NOT EXISTS events_agent ON events(agent_id, tick);
CREATE INDEX IF NOT EXISTS events_kind ON events(kind, tick);

CREATE TABLE IF NOT EXISTS snapshots (
  tick INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  agents INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sex TEXT NOT NULL,
  born_tick INTEGER NOT NULL,
  died_tick INTEGER,
  cause_of_death TEXT,
  parents TEXT NOT NULL DEFAULT '[null,null]',
  genome TEXT NOT NULL DEFAULT '{}',
  cultural_genome TEXT NOT NULL DEFAULT '',
  group_id INTEGER,
  last_state TEXT NOT NULL DEFAULT '{}',
  updated_tick INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  importance REAL NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  refs TEXT NOT NULL DEFAULT '[]',
  pruned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS memories_agent ON memories(agent_id, tick);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, content='memories', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  x INTEGER,
  y INTEGER,
  turns TEXT NOT NULL DEFAULT '[]',
  outcomes TEXT NOT NULL DEFAULT '[]',
  summary_a TEXT,
  summary_b TEXT
);
CREATE INDEX IF NOT EXISTS conversations_a ON conversations(a_id, tick);
CREATE INDEX IF NOT EXISTS conversations_b ON conversations(b_id, tick);

CREATE TABLE IF NOT EXISTS texts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER,
  tick INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  medium TEXT NOT NULL,
  kind TEXT NOT NULL,
  tech_ids TEXT NOT NULL DEFAULT '[]',
  belief_id INTEGER,
  reads INTEGER NOT NULL DEFAULT 0,
  x INTEGER,
  y INTEGER,
  holder_id INTEGER
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL,
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  gave TEXT NOT NULL,
  got TEXT NOT NULL,
  x INTEGER,
  y INTEGER
);
CREATE INDEX IF NOT EXISTS trades_tick ON trades(tick);

CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL,
  agent_id INTEGER,
  call_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  in_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  out_tokens INTEGER NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  prompt_hash TEXT,
  volatile_text TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_calls_tick ON llm_calls(tick);
CREATE INDEX IF NOT EXISTS llm_calls_agent ON llm_calls(agent_id, tick);

CREATE TABLE IF NOT EXISTS beliefs (
  id INTEGER PRIMARY KEY,
  founder_id INTEGER,
  tick INTEGER NOT NULL,
  statement TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id INTEGER,
  explains TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS groups_ (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  founded_tick INTEGER NOT NULL,
  dissolved_tick INTEGER,
  leader_id INTEGER,
  members TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL DEFAULT '#888888',
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  first_tick INTEGER NOT NULL,
  last_tick INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  agent_ids TEXT NOT NULL DEFAULT '[]',
  epoch TEXT
);

CREATE TABLE IF NOT EXISTS chronicle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick_from INTEGER NOT NULL,
  tick_to INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'historia',
  themes TEXT NOT NULL DEFAULT '[]',
  protagonists TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  tick INTEGER PRIMARY KEY,
  json TEXT NOT NULL
);
`;
