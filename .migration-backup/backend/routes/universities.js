import express from 'express'
import { supabase } from '../config/supabase.js'

const router = express.Router()

// GET ALL
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('universities')
    .select('*')
    .order('id')

  if (error) return res.status(400).json(error)
  res.json(data)
})

// CREATE
router.post('/', async (req, res) => {
  const { id, name, pocName, pocNumber, targetDate, trackers, overallReadiness, riskStatus, daysDelayed } = req.body

  const { data, error } = await supabase
    .from('universities')
    .insert([{ 
      id, 
      name, 
      pocName, 
      pocNumber, 
      targetDate,
      trackers,
      overallReadiness,
      riskStatus,
      daysDelayed
    }])
    .select()

  if (error) return res.status(400).json(error)
  res.json(data[0])
})

// UPDATE TRACKERS
router.put('/:id/trackers', async (req, res) => {
  const { id } = req.params;
  const { trackers, overallReadiness } = req.body;

  const { data, error } = await supabase
    .from('universities')
    .update({
      trackers,
      overallReadiness
    })
    .eq('id', id)
    .select();

  if (error) {
    console.error("Supabase PUT Error:", error);
    return res.status(400).json(error);
  }
  res.json(data[0]);
});

export default router
