import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";

const MODEL_CLASSROOM_ITEMS = [
  { category: "🧹 CIVIL & FINISHING", name: "Flooring" },
  { category: "🧹 CIVIL & FINISHING", name: "Painting / Wall Finishing" },
  { category: "🧹 CIVIL & FINISHING", name: "Ceiling / False Ceiling" },
  { category: "🧹 CIVIL & FINISHING", name: "Roller Blinds" },
  { category: "🧹 CIVIL & FINISHING", name: "Electrical Wiring – Concealed & Safe" },
  { category: "🧹 CIVIL & FINISHING", name: "TV wall" },
  { category: "❄️ ELECTRICAL & HVAC", name: "AC Installation" },
  { category: "❄️ ELECTRICAL & HVAC", name: "AC Working Condition" },
  { category: "❄️ ELECTRICAL & HVAC", name: "Lights Working Condition" },
  { category: "❄️ ELECTRICAL & HVAC", name: "UPS Power Connection" },
  { category: "❄️ ELECTRICAL & HVAC", name: "Power Sockets / Outlets" },
  { category: "❄️ ELECTRICAL & HVAC", name: "Transformer & MCB Panels" },
  { category: "❄️ ELECTRICAL & HVAC", name: "Generator capacity" },
  { category: "🪑 FURNITURE & SEATING", name: "Bench with Seater" },
  { category: "🪑 FURNITURE & SEATING", name: "Bench Charging Points" },
  { category: "🪑 FURNITURE & SEATING", name: "Teacher's Podium / Desk" },
  { category: "🌐 TV, AV & WIFI", name: "Internet & Access Points Installation" },
  { category: "🌐 TV, AV & WIFI", name: "Network Configuration and Testing" },
  { category: "🌐 TV, AV & WIFI", name: "TV - Working" },
  { category: "🌐 TV, AV & WIFI", name: "Audio - Speaker, Amplifier, Mixer, Mic" },
  { category: "🌐 TV, AV & WIFI", name: "AV - Working Condition" },
  { category: "🌐 TV, AV & WIFI", name: "Audio Tuning & Testing" },
  { category: "🌐 TV, AV & WIFI", name: "HDMI Connectivity" },
  { category: "🔒 SECURITY & SURVEILLANCE", name: "CCTV Installation" },
  { category: "🔒 SECURITY & SURVEILLANCE", name: "CCTV Working Condition" },
  { category: "🔒 SECURITY & SURVEILLANCE", name: "Door Lock / Access Control" },
];

const LAB_ITEMS = [
  { category: "Furniture", name: "3D Printing Table / Assembly Table", specification: "Heavy-duty 150×60×75 cm metal-leg table" },
  { category: "Furniture", name: "Material Store Rack (Metal Rack)", specification: '5-Tier Metal Storage Shelf – 63"H × 24"W × 12"D' },
  { category: "Lighting", name: "Ambient Ceiling Light – Round Panel", specification: "4000K neutral white – circular pendant" },
  { category: "HVAC", name: "Air Conditioning (Cassette Type)", specification: "1.5-ton cassette AC" },
  { category: "Electrical", name: "Power Sockets & Charging Points", specification: "Integrated sockets and USB ports at workstations" },
  { category: "UPS / Power Backup", name: "UPS Power Backup", specification: "Min 5 KVA for lab equipment" },
  { category: "Security", name: "CCTV Cameras", specification: "Safety, discipline, and monitored learning" },
  { category: "Connectivity", name: "Wi-Fi Access Points", specification: "Aruba AP-515 / AP-505 Wi-Fi 6" },
];

const STAFF_ROOM_ITEMS = [
  { category: "Space", name: "Staffroom Area – General Seating" },
  { category: "Space", name: "Head Cabin" },
  { category: "Space", name: "Meeting Cabin" },
  { category: "Storage", name: "Storage Area" },
  { category: "Electrical", name: "Adequate Lighting" },
  { category: "Electrical", name: "Power Sockets" },
  { category: "HVAC", name: "Air Conditioning (AC)" },
  { category: "Civil", name: "Natural Ventilation" },
  { category: "Connectivity", name: "Wi-Fi Access" },
  { category: "Security", name: "CCTV (optional)" },
  { category: "Furniture", name: "Ergonomic Chairs" },
  { category: "Furniture", name: "Work Tables" },
  { category: "Furniture", name: "Storage Racks" },
];

// Overall classroom uses same items as model classroom
const OVERALL_CLASSROOM_ITEMS = [...MODEL_CLASSROOM_ITEMS];

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Seed checklist items
  const modules = [
    { module: "model_classroom", items: MODEL_CLASSROOM_ITEMS },
    { module: "lab", items: LAB_ITEMS },
    { module: "staff_room", items: STAFF_ROOM_ITEMS },
    { module: "overall_classroom", items: OVERALL_CLASSROOM_ITEMS },
  ];

  for (const { module, items } of modules) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await prisma.checklistItem.upsert({
        where: { id: `${module}_${i}` },
        update: { ...item, module, sortOrder: i },
        create: { id: `${module}_${i}`, module, category: item.category, name: item.name, specification: (item as any).specification || null, sortOrder: i },
      });
    }
    console.log(`  ✓ ${module}: ${items.length} items`);
  }

  // 2. Create bootstrap admin user (dev-only unless SEED_ADMIN_EMAIL is explicitly set)
  const adminEmail = process.env.SEED_ADMIN_EMAIL || (process.env.NODE_ENV !== "production" ? "admin@niat.ac.in" : null);
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (process.env.NODE_ENV !== "production" ? "Admin@123" : null);

  if (adminEmail && adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await prisma.user.create({
        data: {
          name: "System Admin",
          email: adminEmail,
          passwordHash,
          role: "admin",
          zoneIds: [],
          universityIds: [],
        },
      });
      console.log(`  ✓ Created admin user: ${adminEmail}`);
    } else {
      console.log(`  ✓ Admin user already exists: ${adminEmail}`);
    }
  } else {
    console.log("  ⚠ Skipping admin user creation in production — set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD env vars to bootstrap.");
  }

  console.log("✅ Seeding complete!");
}

main()
  .catch(err => { console.error("Seed error:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
