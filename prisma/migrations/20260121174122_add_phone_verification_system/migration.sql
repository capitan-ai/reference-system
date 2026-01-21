-- CreateTable
CREATE TABLE IF NOT EXISTS "phone_verifications" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "verified_phone_sessions" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_phone_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "phone_verifications_phone_number_verified_idx" ON "phone_verifications"("phone_number", "verified");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "phone_verifications_expires_at_idx" ON "phone_verifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "verified_phone_sessions_session_token_key" ON "verified_phone_sessions"("session_token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "verified_phone_sessions_phone_number_idx" ON "verified_phone_sessions"("phone_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "verified_phone_sessions_session_token_idx" ON "verified_phone_sessions"("session_token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "verified_phone_sessions_expires_at_idx" ON "verified_phone_sessions"("expires_at");
