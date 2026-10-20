import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// MIG-05: idempotent global reference data. Plan values are placeholders until D-07 is decided.
try {
  process.loadEnvFile();
} catch {}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const features = (on: string[]) =>
  Object.fromEntries(["ai", "zatcaPhase2", "ledger", "apiAccess", "customBranding", "paymentGateway", "exportsXlsx"].map((f) => [f, on.includes(f)]));

const plans = [
  { code: "TRIAL", nameEn: "Trial", nameAr: "تجريبي", entitlements: { maxUsers: 5, maxBranches: 2, storageGb: 1, maxBookingsPerMonth: 100, aiCreditsPerMonth: 0, features: features(["customBranding"]) } },
  { code: "STARTER", nameEn: "Starter", nameAr: "المبتدئ", entitlements: { maxUsers: 10, maxBranches: 3, storageGb: 10, maxBookingsPerMonth: 500, aiCreditsPerMonth: 0, features: features(["customBranding", "exportsXlsx"]) } },
  { code: "PROFESSIONAL", nameEn: "Professional", nameAr: "الاحترافي", entitlements: { maxUsers: 50, maxBranches: 10, storageGb: 100, maxBookingsPerMonth: null, aiCreditsPerMonth: 1000, features: features(["customBranding", "exportsXlsx", "ai", "paymentGateway"]) } },
  { code: "ENTERPRISE", nameEn: "Enterprise", nameAr: "المؤسسات", entitlements: { maxUsers: 500, maxBranches: 50, storageGb: 1000, maxBookingsPerMonth: null, aiCreditsPerMonth: 10000, features: features(["customBranding", "exportsXlsx", "ai", "paymentGateway", "zatcaPhase2", "ledger", "apiAccess"]) } },
];

for (const p of plans) await prisma.plan.upsert({ where: { code: p.code }, update: { nameEn: p.nameEn, nameAr: p.nameAr, entitlements: p.entitlements }, create: p });
console.log(`Seeded ${plans.length} plans`);
await prisma.$disconnect();
