import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Helper to read users
const readUsers = () => {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

// Helper to write users
const writeUsers = (users) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
};

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 1. CREATE SPACE & AUTO-POPULATE CHECKLIST
app.post('/api/spaces', async (req, res) => {
  const { university_uuid, space_type, name, floor, capacity, planned_ready_date } = req.body;

  try {
    // A. Create the Space (Use upsert to prevent duplicates)
    const { data: space, error: spaceError } = await supabase
      .from('spaces')
      .upsert([{ university_uuid, space_type, name, floor, capacity, planned_ready_date }], { onConflict: 'university_uuid,space_type,name' })
      .select()
      .single();

    if (spaceError) throw spaceError;

    // B. Fetch Checklist Items for this module
    const { data: items, error: itemsError } = await supabase
      .from('checklist_items')
      .select('id')
      .eq('module', space_type);

    if (itemsError) throw itemsError;

    // C. Auto-populate Status Updates (Yet to start)
    if (items && items.length > 0) {
      const updates = items.map(item => ({
        space_id: space.id,
        checklist_item_id: item.id,
        university_uuid: university_uuid,
        status: 'Yet to start'
      }));

      const { error: populateError } = await supabase
        .from('status_updates')
        .insert(updates);

      if (populateError) throw populateError;
    }

    res.status(201).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. GET SPACE CHECKLIST
app.get('/api/spaces/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('status_updates')
      .select(`
        id, status, photo_url, remarks, vendor_suggestion, actual_date,
        checklist_items (id, name, category, specification)
      `)
      .eq('space_id', req.params.id);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. UPDATE STATUS / EVIDENCE
app.patch('/api/status/:id', async (req, res) => {
  const { status, remarks, photo_url, actual_date } = req.body;
  try {
    const { data, error } = await supabase
      .from('status_updates')
      .update({ status, remarks, photo_url, actual_date, updated_at: new Date() })
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. ANALYTICS (GOD-MODE)
app.get('/api/analytics', async (req, res) => {
  try {
    const { data: unis, error } = await supabase
      .from('universities')
      .select(`
        uuid_id, name, risk_status,
        status_updates (status, vendor_required)
      `);

    if (error) throw error;

    const stats = unis.map(u => {
      const total = u.status_updates?.length || 0;
      const done = u.status_updates?.filter(s => s.status === 'Done').length || 0;
      return {
        name: u.name,
        risk: u.risk_status,
        readiness: total > 0 ? Math.round((done / total) * 100) : 0,
        vendorItems: u.status_updates?.filter(s => s.vendor_required).length || 0
      };
    });

    res.json(stats);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. USER CRUD OPERATIONS (File-based)
app.get('/api/users', (req, res) => {
  try {
    const users = readUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/users', (req, res) => {
  try {
    const users = readUsers();
    const newUser = { id: Date.now().toString(), ...req.body };
    users.push(newUser);
    writeUsers(users);
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/users/:id', (req, res) => {
  try {
    let users = readUsers();
    const index = users.findIndex(u => String(u.id) === String(req.params.id));
    if (index === -1) return res.status(404).json({ success: false, message: 'User not found' });
    
    users[index] = { ...users[index], ...req.body, id: users[index].id };
    writeUsers(users);
    res.json(users[index]);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/users/:id', (req, res) => {
  try {
    let users = readUsers();
    users = users.filter(u => String(u.id) !== String(req.params.id));
    writeUsers(users);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Infra API running on port ${PORT}`));
