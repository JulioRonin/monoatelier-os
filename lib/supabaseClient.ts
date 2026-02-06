
import { createClient } from '@supabase/supabase-js'

// Create a single supabase client for interacting with your database
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail gracefully if keys are missing to prevent white screen of death
// This allows the app to load and show a specific error message instead of crashing
let client = null;

if (supabaseUrl && supabaseAnonKey) {
    client = createClient(supabaseUrl, supabaseAnonKey);
} else {
    console.error("Supabase credentials missing! Check .env.local");
}

export const supabase = client!; // Exporting as possibly null, handled in api.ts
