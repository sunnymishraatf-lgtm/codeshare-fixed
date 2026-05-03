-- ============================================
-- DATABASE SCHEMA
-- ============================================

-- Users table (optional, for auth later)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Main snippets table (stores all code generations)
CREATE TABLE snippets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Shareable public ID (short slug for URLs)
    slug VARCHAR(12) UNIQUE NOT NULL,

    -- Input classification
    input_type VARCHAR(20) NOT NULL CHECK (input_type IN ('question', 'code', 'file')),
    language VARCHAR(50) NOT NULL,

    -- Raw user input
    user_input TEXT NOT NULL,

    -- AI-generated output
    generated_code TEXT NOT NULL,
    generated_output TEXT,

    -- Metadata
    model_used VARCHAR(50) DEFAULT 'gpt-4.1-mini',
    prompt_version INTEGER DEFAULT 1,

    -- Optional: user association
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Analytics
    view_count INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT TRUE
);

-- Indexes for performance
CREATE INDEX idx_snippets_slug ON snippets(slug);
CREATE INDEX idx_snippets_created ON snippets(created_at DESC);
CREATE INDEX idx_snippets_user ON snippets(user_id);

-- File uploads table (for uploaded code files)
CREATE TABLE file_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snippet_id UUID REFERENCES snippets(id) ON DELETE CASCADE,

    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,  -- UUID-based filename on disk
    file_size_bytes INTEGER,
    mime_type VARCHAR(100),

    extracted_text TEXT,  -- OCR/extracted content
    language_detected VARCHAR(50),

    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API request logs (for debugging/monitoring)
CREATE TABLE api_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snippet_id UUID REFERENCES snippets(id) ON DELETE SET NULL,

    request_type VARCHAR(20) NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    latency_ms INTEGER,

    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MIGRATION: Add updated_at trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_snippets_updated_at 
    BEFORE UPDATE ON snippets 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();