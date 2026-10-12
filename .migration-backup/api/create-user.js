import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password, name, role, zone_ids, university_ids } = req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: Missing Auth Header' });
  }

  // 1. Initialize the Admin Client (Master Access)
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 2. Verify the caller is an Admin
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(token);

    if (callerError || !caller) {
      throw new Error('Unauthorized: Invalid Token');
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('personnel')
      .select('role')
      .eq('id', caller.id)
      .single();

    // Check database role OR auth metadata role
    const callerRole = callerProfile?.role || caller.user_metadata?.role;

    if (callerRole !== 'admin' && caller.email !== 'riteesh.reddy@nxtwave.co.in') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // 3. Create the user in Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role: role }
    });

    if (authError) throw authError;

    // 4. Create the Directory Record (including plain-text password for admin reference)
    const { error: dbError } = await supabaseAdmin
      .from('personnel')
      .insert([{
        id: authData.user.id,
        email,
        name,
        role,
        zone_ids,
        university_ids,
        is_active: true,
        password: password // Storing for admin visibility as requested
      }]);

    if (dbError) throw dbError;

    return res.status(200).json({ success: true, user: authData.user });
  } catch (error) {
    console.error('Admin Create User Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
