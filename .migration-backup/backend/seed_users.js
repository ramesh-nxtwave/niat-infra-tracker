require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const USERS = [
  // Super admin
  { email: 'riteesh.reddy@nxtwave.co.in', password: 'admin123', role: 'admin', name: 'Riteesh Reddy' },

  // Zonal managers
  { email: 'ramesh@nxtwave.co.in', password: 'ramesh@123', role: 'zonal_manager', name: 'Ramesh', zone_id: 1 },
  { email: 'sumith@nxtwave.co.in', password: 'sumith@123', role: 'zonal_manager', name: 'Sumith', zone_id: 2 },
  
  // Extra Zonal Slots
  { email: 'zone3@nxtwave.co.in', password: 'zone3@123', role: 'zonal_manager', name: 'Zone 3 Manager', zone_id: 3 },
  { email: 'zone4@nxtwave.co.in', password: 'zone4@123', role: 'zonal_manager', name: 'Zone 4 Manager', zone_id: 4 },
  { email: 'zone5@nxtwave.co.in', password: 'zone5@123', role: 'zonal_manager', name: 'Zone 5 Manager', zone_id: 5 },

  // APMs
  { email: 'apm1@nxtwave.co.in', password: 'apm1@123', role: 'apm', name: 'APM 1', university_ids: [1, 2] },
  { email: 'apm2@nxtwave.co.in', password: 'apm2@123', role: 'apm', name: 'APM 2', university_ids: [3] },
  { email: 'apm3@nxtwave.co.in', password: 'apm3@123', role: 'apm', name: 'APM 3', university_ids: [] },
  { email: 'apm4@nxtwave.co.in', password: 'apm4@123', role: 'apm', name: 'APM 4', university_ids: [] },

  // Legacy ops login
  { email: 'ops@nxtwave.co.in', password: 'ops123', role: 'ops', name: 'On-Ground Team' },
];

async function setupDatabase() {
  console.log('Creating app_users table...');
  
  // Since we cannot run raw DDL easily via the JS client without RPC, 
  // and we don't have direct access to run raw SQL, we will use the REST API 
  // via a trick: If we insert data into a non-existent table, it fails.
  // Wait, Supabase allows creating tables via raw SQL if we have the connection string.
  // We can just use pg module.
}

setupDatabase();
