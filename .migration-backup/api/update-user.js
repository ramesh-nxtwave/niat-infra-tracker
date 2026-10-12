import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, name, role, is_active, zone_ids, university_ids } = req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: Missing Auth Header' });
  }

  // 1. Initialize the Admin Client
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 2. Verify caller is admin
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

    const callerRole = callerProfile?.role || caller.user_metadata?.role;

    if (callerRole !== 'admin' && caller.email !== 'riteesh.reddy@nxtwave.co.in') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // 3. Update Auth Metadata (This ensures the role change sticks in their session)
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      id,
      { user_metadata: { full_name: name, role: role } }
    );

    if (authError) throw authError;

    // 4. Update Personnel Table
    const { error: dbError } = await supabaseAdmin
      .from('personnel')
      .update({
        name,
        role,
        is_active,
        zone_ids,
        university_ids,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (dbError) throw dbError;

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Admin Update User Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
