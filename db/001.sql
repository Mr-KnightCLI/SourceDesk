CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  owner uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  content bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','indexing','ready','failed')),
  attempt uuid,
  error text,
  updated timestamptz NOT NULL DEFAULT now(),
  created timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner);
CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  location text NOT NULL,
  excerpt text NOT NULL,
  embedding vector NOT NULL,
  model text NOT NULL,
  UNIQUE (document, ordinal)
);
