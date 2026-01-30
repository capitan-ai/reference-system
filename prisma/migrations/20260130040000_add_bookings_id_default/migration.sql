-- Add default UUID for bookings.id to match Prisma schema
ALTER TABLE "bookings"
ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

