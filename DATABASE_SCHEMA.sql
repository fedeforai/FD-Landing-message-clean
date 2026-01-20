-- Database Schema Requirements
-- Run these in Supabase SQL Editor

-- Ensure conversation_events table exists
CREATE TABLE IF NOT EXISTS conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation_id 
  ON conversation_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_created_at 
  ON conversation_events(created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_events_event_type 
  ON conversation_events(event_type);

-- Index for trace_id queries (if metadata contains trace_id)
CREATE INDEX IF NOT EXISTS idx_conversation_events_trace_id 
  ON conversation_events USING GIN ((metadata->>'trace_id'));

-- Ensure tasks table has metadata column
ALTER TABLE tasks 
ALTER COLUMN metadata TYPE JSONB USING metadata::jsonb;

-- Index for task metadata trace_id
CREATE INDEX IF NOT EXISTS idx_tasks_metadata_trace_id 
  ON tasks USING GIN ((metadata->>'trace_id'));

-- Ensure conversation_threads has handoff_to_human column
ALTER TABLE conversation_threads 
ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE;

-- Index for handoff queries
CREATE INDEX IF NOT EXISTS idx_conversation_threads_handoff 
  ON conversation_threads(handoff_to_human) 
  WHERE handoff_to_human = true;

-- RLS Policies (adjust based on your security model)
ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access" ON conversation_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can read their own conversation events
CREATE POLICY "Users can read own events" ON conversation_events
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversation_threads 
      WHERE user_id = auth.uid()
    )
  );
