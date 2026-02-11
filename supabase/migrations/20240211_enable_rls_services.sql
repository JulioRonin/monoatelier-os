-- Enable RLS on the table 'services'
ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access to 'services'
-- This allows both anonymous (unauthenticated) and authenticated users to read.
CREATE POLICY "Public read access for services"
ON "public"."services"
AS PERMISSIVE
FOR SELECT
TO public
USING (true);

-- Enable RLS on the table 'service_variables'
ALTER TABLE "public"."service_variables" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access to 'service_variables'
CREATE POLICY "Public read access for service_variables"
ON "public"."service_variables"
AS PERMISSIVE
FOR SELECT
TO public
USING (true);
