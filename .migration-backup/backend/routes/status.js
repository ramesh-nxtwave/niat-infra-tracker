import express from 'express'
import { supabase } from '../config/supabase.js'

const router = express.Router()

// CREATE STATUS UPDATE
router.post('/', async (req, res) => {
  const {
    university_id,
    space_id,
    checklist_item_id,
    status,
    photo_url,
    remarks
  } = req.body

  const { data, error } = await supabase
    .from('status_updates')
    .insert([
      {
        university_id,
        space_id,
        checklist_item_id,
        status,
        photo_url,
        remarks
      }
    ])

  if (error) return res.status(400).json(error)
  res.json(data)
})

// GET ALL UPDATES
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('status_updates')
    .select('*')

  if (error) return res.status(400).json(error)
  res.json(data)
})

export default router
