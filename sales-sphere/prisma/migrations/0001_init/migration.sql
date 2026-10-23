-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ListTypeStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "ExclusionKind" AS ENUM ('domain', 'company');

-- CreateEnum
CREATE TYPE "ExclusionReason" AS ENUM ('blocked', 'client', 'not_interested', 'rejected', 'bounced');

-- CreateEnum
CREATE TYPE "VoiceExampleKind" AS ENUM ('seed', 'edit');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('created', 'awaiting_run_confirmation', 'discovering', 'awaiting_enrich_confirmation', 'enriching', 'writing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('hot', 'warm', 'cold');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('found', 'qualified', 'disqualified', 'contact_found', 'no_contact', 'linkedin_phone_only', 'drafted', 'approved', 'sent', 'replied', 'out_of_office', 'bounced', 'not_interested', 'rejected');

-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('initial', 'followup1', 'followup2');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'queued_to_send', 'sent', 'failed');

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "personaName" TEXT NOT NULL,
    "personaTone" TEXT NOT NULL DEFAULT 'founder and hands-on consultant, peer to peer, confident and direct',
    "signOff" TEXT NOT NULL DEFAULT 'Best,',
    "signatureHtml" TEXT NOT NULL DEFAULT '',
    "dailyDraftLimit" INTEGER NOT NULL DEFAULT 50,
    "allowSend" BOOLEAN NOT NULL DEFAULT false,
    "encryptedRefreshToken" TEXT,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "graphUserId" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastReplySyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locations" JSONB NOT NULL,
    "timeZone" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "spelling" TEXT NOT NULL DEFAULT 'en-GB',
    "complianceNote" TEXT NOT NULL DEFAULT '',
    "complianceFooter" TEXT NOT NULL DEFAULT '',
    "defaultMailboxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListType" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ListTypeStatus" NOT NULL DEFAULT 'active',
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofPoint" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exclusion" (
    "id" TEXT NOT NULL,
    "kind" "ExclusionKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" "ExclusionReason" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "VoiceExample" (
    "id" TEXT NOT NULL,
    "kind" "VoiceExampleKind" NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "before" TEXT,
    "after" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "sizeLabel" TEXT,
    "location" TEXT,
    "area" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "hours" TEXT,
    "linkedinUrl" TEXT,
    "apolloOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "listTypeId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "targetCount" INTEGER NOT NULL,
    "verticalText" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'created',
    "pendingConfirmation" JSONB,
    "estimatedCredits" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "estimatedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "score" INTEGER,
    "tier" "Tier",
    "whyNow" TEXT,
    "signal" TEXT,
    "pitch" TEXT,
    "confidence" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" "ProspectStatus" NOT NULL DEFAULT 'found',
    "replySummary" TEXT,
    "meetingBooked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "prospectId" TEXT,
    "apolloId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "emailStatus" TEXT,
    "linkedinUrl" TEXT,
    "phone" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "kind" "DraftKind" NOT NULL DEFAULT 'initial',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "originalBody" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'pending_review',
    "regenerateNote" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "graphMessageId" TEXT,
    "sentMessageId" TEXT,
    "conversationId" TEXT,
    "outlookCreatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalCall" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costUnit" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "campaignId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_email_key" ON "Mailbox"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ListType_slug_key" ON "ListType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Exclusion_kind_value_key" ON "Exclusion"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE INDEX "CampaignLog_campaignId_createdAt_idx" ON "CampaignLog"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_companyId_key" ON "Prospect"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_prospectId_key" ON "Contact"("prospectId");

-- CreateIndex
CREATE INDEX "Draft_mailboxId_outlookCreatedAt_idx" ON "Draft"("mailboxId", "outlookCreatedAt");

-- CreateIndex
CREATE INDEX "ExternalCall_provider_createdAt_idx" ON "ExternalCall"("provider", "createdAt");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_defaultMailboxId_fkey" FOREIGN KEY ("defaultMailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_listTypeId_fkey" FOREIGN KEY ("listTypeId") REFERENCES "ListType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCall" ADD CONSTRAINT "ExternalCall_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

