import os
from supabase import create_client, Client
 
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://mosucapcjbbcgndciurt.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vc3VjYXBjamJiY2duZGNpdXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ2MzksImV4cCI6MjA5NDA4MDYzOX0.K3cm12jOCTHRsPZDziPDXt3EsWTQAl-BpGKc2i1_CCk")
 
if not SUPABASE_KEY:
    raise ValueError("SUPABASE_KEY environment variable is required")
 
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)