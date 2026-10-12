import express from 'express'
import { supabase } from '../config/supabase.js'

const router = express.Router()

router.get('/', async (req, res) => {
  const { module } = req.query

  const { data, error } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('module', module)

  if (error) return res.status(400).json(error)
  res.json(data)
})

export default router
