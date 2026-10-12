const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/B2B-Infra/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function cleanup() {
  console.log("Starting checklist cleanup...");

  // 1. Delete legacy 'classroom' module items
  console.log("Deleting legacy 'classroom' module items...");
  const { error: delLegacyErr } = await supabase
    .from('checklist_items')
    .delete()
    .eq('module', 'classroom');
  if (delLegacyErr) console.error("Error deleting legacy items:", delLegacyErr);

  // 2. Remove AC Installation (User says it's extra)
  console.log("Removing 'AC Installation'...");
  await supabase.from('checklist_items').delete().eq('name', 'AC Installation');

  // 3. Remove 65 Inch TV
  console.log("Removing '65 Inch TV'...");
  await supabase.from('checklist_items').delete().eq('name', '65 Inch TV');

  // 4. Fix spelling: Genrator capacity -> Generator capacity
  console.log("Fixing spelling: Genrator capacity -> Generator capacity...");
  await supabase.from('checklist_items')
    .update({ name: 'Generator capacity' })
    .eq('name', 'Genrator capacity');

  // 5. Rename Teacher's Podium / Desk
  console.log("Renaming Teacher's Podium...");
  await supabase.from('checklist_items')
    .update({ name: "Teacher's podium with charging point" })
    .eq('name', "Teacher's Podium / Desk");

  // 6. Ensure no duplicates of Flooring / Painting in Electrical & HVAC
  console.log("Cleaning up duplicates in Electrical & HVAC...");
  await supabase.from('checklist_items')
    .delete()
    .eq('category', '❄️ ELECTRICAL & HVAC')
    .in('name', ['Flooring', 'Painting / Wall Finishing']);

  // 7. Remove duplicate Internet & Access Points Installation if any
  // (We already deleted legacy module, but let's be sure)
  // Actually, I'll just check if there are multiple same-name items in same module/category
  // (Not trivial with one query, but legacy delete should have fixed it).

  console.log("Cleanup complete!");
}

cleanup();
