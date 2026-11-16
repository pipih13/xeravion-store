-- XERAVION MAIL initial schema (Cloudflare D1)
PRAGMA foreign_keys = ON;

-- mailbox_type and game_code are admin-side metadata only.
-- They must never be exposed as game-category navigation in the buyer inbox.
CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE COLLATE NOCASE,
  mailbox_type TEXT NOT NULL DEFAULT 'game_account'
    CHECK (mailbox_type IN ('support', 'game_account')),
  game_code TEXT
    CHECK (game_code IS NULL OR game_code IN ('ml', 'ff', 'pubg')),
  access_token_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (mailbox_type = 'support' AND address = 'support@xeravion.my.id' AND game_code IS NULL)
    OR
    (mailbox_type = 'game_account' AND game_code IN ('ml', 'ff', 'pubg'))
  )
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  r2_key TEXT NOT NULL UNIQUE,
  raw_size INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received
  ON messages(mailbox_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_mailboxes_type_game
  ON mailboxes(mailbox_type, game_code, is_active);
