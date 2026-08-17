-- CreateTable
CREATE TABLE "PdfImportDraft" (
    "id" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdfImportDraft_pkey" PRIMARY KEY ("id")
);

