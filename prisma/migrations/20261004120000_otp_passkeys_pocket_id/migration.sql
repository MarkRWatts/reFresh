-- Sign-in moves to email code + passkeys + Pocket ID on Better Auth 1.7.7
-- (see src/auth.ts).
--
-- Account.issuer: dropped. Better Auth 1.7.0-1.7.2 required it; 1.7.3+
-- identifies an account by providerId + accountId again (already unique
-- here) and never writes it, so leaving it NOT NULL would fail every new
-- Account insert, e.g. the first Pocket ID sign-in linking to an existing
-- user. Existing Google Account rows keep everything else.
--
-- Account.password: added, never written (no email/password sign-in), but
-- part of Better Auth's core account schema, which 1.7.3+ validates at
-- startup before it will serve any sign-in.
--
-- Passkey: the @better-auth/passkey plugin's table, cascading with its User.
--
-- Verification rows are left alone: any outstanding magic-link token just
-- expires (10 minutes) unused.

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "issuer",
ADD COLUMN     "password" TEXT;

-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- CreateIndex
CREATE INDEX "Passkey_credentialID_idx" ON "Passkey"("credentialID");

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
