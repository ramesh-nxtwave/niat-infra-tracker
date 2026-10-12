import express from 'express'
import { supabase } from '../config/supabase.js'

const router = express.Router()

// UNIVERSITY READINESS
router.get('/university', async (req, res) => {
  const { data, error } = await supabase.rpc('university_readiness')

  if (error) return res.status(400).json(error)
  res.json(data)
})

// DELAYS
router.get('/delays', async (req, res) => {
  const { data, error } = await supabase
    .from('status_updates')
    .select('*')
    .lt('university_timeline', new Date().toISOString())
    .neq('status', 'Done')

  if (error) return res.status(400).json(error)
  res.json(data)
})

export default router
