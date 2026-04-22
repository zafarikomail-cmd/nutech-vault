-- ═══════════════════════════════════════════════════════
-- database-setup.sql — NUTECH Vault Database Setup
-- Version 2.1 — Added `visibility` column to memories table
--
-- HOW TO USE:
-- 1. Go to your Supabase dashboard: https://supabase.com/dashboard
-- 2. Click your project → SQL Editor → New query
-- 3. Paste this entire file and click Run
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  student_id  TEXT UNIQUE,
  department  TEXT,
  batch_year  INTEGER,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── memories table ─────────────────────────────────────
-- visibility column: 'public' | 'department' | 'private'
CREATE TABLE IF NOT EXISTS public.memories (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT,
  category    TEXT,
  department  TEXT,
  year        INTEGER,
  photo_url   TEXT,
  is_public   BOOLEAN DEFAULT TRUE,
  visibility  TEXT DEFAULT 'public',
  likes       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- If you already ran the old SQL, run this to add the visibility column:
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public';

CREATE TABLE IF NOT EXISTS public.likes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_id   UUID REFERENCES public.memories(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(memory_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.comments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_id   UUID REFERENCES public.memories(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security ──────────────────────────────────
ALTER TABLE public.profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments  ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY IF NOT EXISTS "Profiles are viewable by everyone"     ON public.profiles FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Users can insert own profile"          ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY IF NOT EXISTS "Users can update own profile"          ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Memories — RLS allows all authenticated users to read (privacy enforced in JS)
CREATE POLICY IF NOT EXISTS "Public memories are viewable by everyone" ON public.memories FOR SELECT USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Authenticated users can insert memories"  ON public.memories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can update own memories"            ON public.memories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can delete own memories"            ON public.memories FOR DELETE USING (auth.uid() = user_id);

-- Likes
CREATE POLICY IF NOT EXISTS "Likes are viewable by everyone"        ON public.likes FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Authenticated users can insert likes"   ON public.likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can delete own likes"             ON public.likes FOR DELETE USING (auth.uid() = user_id);

-- Comments
CREATE POLICY IF NOT EXISTS "Comments are viewable by everyone"     ON public.comments FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Authenticated users can insert comments" ON public.comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can delete own comments"          ON public.comments FOR DELETE USING (auth.uid() = user_id);

-- ── Storage Policies ────────────────────────────────────
-- IMPORTANT: Before running these, create the storage bucket manually:
-- Supabase Dashboard → Storage → New Bucket → name: "memory-photos" → check "Public bucket" → Create
CREATE POLICY IF NOT EXISTS "Public read memory photos"             ON storage.objects FOR SELECT USING (bucket_id = 'memory-photos');
CREATE POLICY IF NOT EXISTS "Authenticated upload memory photos"    ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'memory-photos' AND auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Users delete own memory photos"        ON storage.objects FOR DELETE USING (bucket_id = 'memory-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ── Auth trigger — auto-creates profile on sign up ─────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, student_id, department, batch_year)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'student_id',
    NEW.raw_user_meta_data->>'department',
    (NEW.raw_user_meta_data->>'batch_year')::INTEGER
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();