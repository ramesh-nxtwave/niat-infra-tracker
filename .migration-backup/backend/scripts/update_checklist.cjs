const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/B2B-Infra/backend/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const modelItems = [
  ['🧹 CIVIL & FINISHING', 'Flooring'],
  ['🧹 CIVIL & FINISHING', 'Painting / Wall Finishing'],
  ['🧹 CIVIL & FINISHING', 'Ceiling / False Ceiling'],
  ['🧹 CIVIL & FINISHING', 'Roller Blinds'],
  ['🧹 CIVIL & FINISHING', 'Electrical Wiring – Concealed & Safe'],
  ['🧹 CIVIL & FINISHING', 'TV wall'],
  ['❄️ ELECTRICAL & HVAC', 'AC Installation'],
  ['❄️ ELECTRICAL & HVAC', 'AC Working Condition'],
  ['❄️ ELECTRICAL & HVAC', 'Lights Working Condition'],
  ['❄️ ELECTRICAL & HVAC', 'UPS Power Connection'],
  ['❄️ ELECTRICAL & HVAC', 'Power Sockets / Outlets'],
  ['❄️ ELECTRICAL & HVAC', 'Transformer & MCB Panels'],
  ['❄️ ELECTRICAL & HVAC', 'Genrator capacity'],
  ['🪑 FURNITURE & SEATING', 'Bench with Seater'],
  ['🪑 FURNITURE & SEATING', 'Bench Charging Points'],
  ['🪑 FURNITURE & SEATING', 'Teacher\'s Podium / Desk'],
  ['🌐 TV, AV & WIFI', 'Internet & Access Points Installation'],
  ['🌐 TV, AV & WIFI', 'Network Configuration and Testing'],
  ['🌐 TV, AV & WIFI', 'TV - Working'],
  ['🌐 TV, AV & WIFI', 'Audio - Speaker, Amplifier, Mixer, Mic'],
  ['🌐 TV, AV & WIFI', 'AV - Working Condition'],
  ['🌐 TV, AV & WIFI', 'Audio Tuning & Testing'],
  ['🌐 TV, AV & WIFI', 'HDMI Connectivity'],
  ['🔒 SECURITY & SURVEILLANCE', 'CCTV Installation'],
  ['🔒 SECURITY & SURVEILLANCE', 'CCTV Working Condition'],
  ['🔒 SECURITY & SURVEILLANCE', 'Door Lock / Access Control']
];

const labItems = [
  ['Furniture', '3D Printing Table / Assembly Table', 'Heavy-duty 150×60×75 cm metal-leg table (Amazon ref)'],
  ['Furniture', 'Material Store Rack (Metal Rack)', '5-Tier Metal Storage Shelf – 63"H × 24"W × 12"D (Amazon ref)'],
  ['Lighting', 'Ambient Ceiling Light – Round Panel', '4000K neutral white – circular pendant/flush mount LED'],
  ['HVAC', 'Air Conditioning (Cassette Type)', '1.5-ton cassette AC – comfortable lab temperature'],
  ['Electrical', 'Power Sockets & Charging Points', 'Integrated sockets and USB ports at workstations'],
  ['UPS / Power Backup', 'UPS / Power Backup', 'Min 5 KVA for lab equipment'],
  ['Security', 'CCTV Cameras', 'Safety, discipline, and monitored learning environment'],
  ['Connectivity', 'Wi-Fi Access Points (Aruba Wi-Fi 6)', 'Aruba AP-515 / AP-505 – fast, stable, secure internet']
];

const staffItems = [
  ['Space', 'Staffroom Area – General Seating'],
  ['Space', 'Head Cabin'],
  ['Space', 'Meeting Cabin'],
  ['Storage', 'Storage Area'],
  ['Electrical', 'Adequate Lighting'],
  ['Electrical', 'Power Sockets'],
  ['HVAC', 'Air Conditioning (AC)'],
  ['Civil', 'Natural Ventilation'],
  ['Connectivity', 'Wi-Fi Access'],
  ['Security', 'CCTV (optional)'],
  ['Furniture', 'Ergonomic Chairs'],
  ['Furniture', 'Work Tables'],
  ['Furniture', 'Storage Racks']
];

async function run() {
  console.log('Cleaning existing items...');
  await supabase.from('checklist_items').delete().in('module', ['model_classroom', 'lab', 'staff_room', 'overall_classroom']);

  const inserts = [];
  modelItems.forEach(([cat, name]) => {
    inserts.push({ module: 'model_classroom', category: cat, name });
    inserts.push({ module: 'overall_classroom', category: cat, name });
  });
  labItems.forEach(([cat, name, spec]) => {
    inserts.push({ module: 'lab', category: cat, name, specification: spec });
  });
  staffItems.forEach(([cat, name]) => {
    inserts.push({ module: 'staff_room', category: cat, name });
  });

  console.log(`Inserting ${inserts.length} items...`);
  const { error } = await supabase.from('checklist_items').insert(inserts);
  if (error) console.error(error);
  else console.log('Successfully updated checklist items.');
}

run();
