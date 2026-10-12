import express from 'express'
import { supabase } from '../config/supabase.js'

const router = express.Router()

// CREATE SPACE
router.post('/', async (req, res) => {
  const {
    university_id,
    space_type,
    name,
    floor,
    capacity,
    timeline
  } = req.body

  const { data, error } = await supabase.from('spaces').insert([
    { university_id, space_type, name, floor, capacity, timeline }
  ])

  if (error) return res.status(400).json(error)
  res.json(data)
})

// GET SPACES BY UNIVERSITY
router.get('/:university_id', async (req, res) => {
  const { data, error } = await supabase
    .from('spaces')
    .select('*')
    .eq('university_id', req.params.university_id)

  if (error) return res.status(400).json(error)
  res.json(data)
})

export default router
