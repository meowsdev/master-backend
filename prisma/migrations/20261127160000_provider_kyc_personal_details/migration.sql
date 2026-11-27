-- KYC step 1 (personal details): parents' names, gender, a contact number and the NID address's post code.
-- Additive only: nullable columns, nothing existing changes.
ALTER TABLE "ProviderKyc" ADD COLUMN "fatherName" VARCHAR(100),
ADD COLUMN "motherName" VARCHAR(100),
ADD COLUMN "gender" VARCHAR(10),
ADD COLUMN "contactPhone" VARCHAR(20),
ADD COLUMN "postCode" VARCHAR(4);
