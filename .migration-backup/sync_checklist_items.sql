-- 1. DELETE existing lab items to clean the slate
-- Note: If you have existing status updates tied to these, they will be deleted 
-- if ON DELETE CASCADE is set. If you don't want to delete existing data, you can just INSERT the missing ones.
-- Since this is an overhaul of the checklist to match the new format, a clean slate for the checklist items is recommended.

-- First, let's insert the new lab items. We'll use DO NOTHING on conflict if you added a unique constraint, but typically there isn't one.
-- To avoid duplicates, let's just delete the old lab items and insert the exact new list.
-- CAUTION: This will delete status_updates for 'lab' spaces.
DELETE FROM checklist_items WHERE module = 'lab';

INSERT INTO checklist_items (id, module, category, name, specification) VALUES
  (gen_random_uuid(), 'lab', 'Furniture', '3D Printing Table / Assembly Table', 'Heavy-duty 150×60×75 cm metal-leg table (Amazon ref)'),
  (gen_random_uuid(), 'lab', 'Furniture', 'Material Store Rack (Metal Rack)', '5-Tier Metal Storage Shelf – 63"H × 24"W × 12"D (Amazon ref)'),
  (gen_random_uuid(), 'lab', 'Lighting', 'Ambient Ceiling Light – Round Panel', '4000K neutral white – circular pendant/flush mount LED'),
  (gen_random_uuid(), 'lab', 'HVAC', 'Air Conditioning (Cassette Type)', '1.5-ton cassette AC – comfortable lab temperature'),
  (gen_random_uuid(), 'lab', 'Electrical', 'Power Sockets & Charging Points', 'Integrated sockets and USB ports at workstations'),
  (gen_random_uuid(), 'lab', 'UPS / Power Backup', 'UPS Power Backup', 'Min 5 KVA for lab equipment'),
  (gen_random_uuid(), 'lab', 'Security', 'CCTV Cameras', 'Safety, discipline, and monitored learning environment'),
  (gen_random_uuid(), 'lab', 'Connectivity', 'Wi-Fi Access Points', 'Aruba AP-515 / AP-505 – fast, stable, secure internet');

-- Staff Room
DELETE FROM checklist_items WHERE module = 'staff_room';
INSERT INTO checklist_items (id, module, category, name, specification) VALUES
  (gen_random_uuid(), 'staff_room', 'Space', 'Staffroom Area – General Seating', NULL),
  (gen_random_uuid(), 'staff_room', 'Space', 'Head Cabin', NULL),
  (gen_random_uuid(), 'staff_room', 'Space', 'Meeting Cabin', NULL),
  (gen_random_uuid(), 'staff_room', 'Storage', 'Storage Area', NULL),
  (gen_random_uuid(), 'staff_room', 'Electrical', 'Adequate Lighting', NULL),
  (gen_random_uuid(), 'staff_room', 'Electrical', 'Power Sockets', NULL),
  (gen_random_uuid(), 'staff_room', 'HVAC', 'Air Conditioning (AC)', NULL),
  (gen_random_uuid(), 'staff_room', 'Connectivity', 'Wi-Fi Access', NULL),
  (gen_random_uuid(), 'staff_room', 'Security', 'CCTV (optional)', NULL),
  (gen_random_uuid(), 'staff_room', 'Furniture', 'Ergonomic Chairs', NULL),
  (gen_random_uuid(), 'staff_room', 'Furniture', 'Work Tables', NULL),
  (gen_random_uuid(), 'staff_room', 'Furniture', 'Storage Racks', NULL);

-- Model Classroom
DELETE FROM checklist_items WHERE module = 'model_classroom';
INSERT INTO checklist_items (id, module, category, name, specification) VALUES
  (gen_random_uuid(), 'model_classroom', '🧹 CIVIL & FINISHING', 'Flooring', NULL),
  (gen_random_uuid(), 'model_classroom', '🧹 CIVIL & FINISHING', 'Painting / Wall Finishing', NULL),
  (gen_random_uuid(), 'model_classroom', '🧹 CIVIL & FINISHING', 'Ceiling / False Ceiling', NULL),
  (gen_random_uuid(), 'model_classroom', '🧹 CIVIL & FINISHING', 'Roller Blinds', NULL),
  (gen_random_uuid(), 'model_classroom', '🧹 CIVIL & FINISHING', 'Electrical Wiring – Concealed & Safe', NULL),
  (gen_random_uuid(), 'model_classroom', '🧹 CIVIL & FINISHING', 'TV wall', NULL),
  
  (gen_random_uuid(), 'model_classroom', '❄️ ELECTRICAL & HVAC', 'AC Installation', NULL),
  (gen_random_uuid(), 'model_classroom', '❄️ ELECTRICAL & HVAC', 'AC Working Condition', NULL),
  (gen_random_uuid(), 'model_classroom', '❄️ ELECTRICAL & HVAC', 'Lights Working Condition', NULL),
  (gen_random_uuid(), 'model_classroom', '❄️ ELECTRICAL & HVAC', 'UPS Power Connection', NULL),
  (gen_random_uuid(), 'model_classroom', '❄️ ELECTRICAL & HVAC', 'Power Sockets / Outlets', NULL),
  (gen_random_uuid(), 'model_classroom', '❄️ ELECTRICAL & HVAC', 'Transformer & MCB Panels', NULL),
  (gen_random_uuid(), 'model_classroom', '❄️ ELECTRICAL & HVAC', 'Genrator capacity', NULL),
  
  (gen_random_uuid(), 'model_classroom', '🪑 FURNITURE & SEATING', 'Bench with Seater', NULL),
  (gen_random_uuid(), 'model_classroom', '🪑 FURNITURE & SEATING', 'Bench Charging Points', NULL),
  (gen_random_uuid(), 'model_classroom', '🪑 FURNITURE & SEATING', 'Teacher''s Podium / Desk', NULL),
  
  (gen_random_uuid(), 'model_classroom', '🌐 TV, AV & WIFI', 'Internet & Access Points Installation', NULL),
  (gen_random_uuid(), 'model_classroom', '🌐 TV, AV & WIFI', 'Network Configuration and Testing', NULL),
  (gen_random_uuid(), 'model_classroom', '🌐 TV, AV & WIFI', 'TV - Working', NULL),
  (gen_random_uuid(), 'model_classroom', '🌐 TV, AV & WIFI', 'Audio - Speaker, Amplifier, Mixer, Mic', NULL),
  (gen_random_uuid(), 'model_classroom', '🌐 TV, AV & WIFI', 'AV - Working Condition', NULL),
  (gen_random_uuid(), 'model_classroom', '🌐 TV, AV & WIFI', 'Audio Tuning & Testing', NULL),
  (gen_random_uuid(), 'model_classroom', '🌐 TV, AV & WIFI', 'HDMI Connectivity', NULL),
  
  (gen_random_uuid(), 'model_classroom', '🔒 SECURITY & SURVEILLANCE', 'CCTV Installation', NULL),
  (gen_random_uuid(), 'model_classroom', '🔒 SECURITY & SURVEILLANCE', 'CCTV Working Condition', NULL),
  (gen_random_uuid(), 'model_classroom', '🔒 SECURITY & SURVEILLANCE', 'Door Lock / Access Control', NULL);
