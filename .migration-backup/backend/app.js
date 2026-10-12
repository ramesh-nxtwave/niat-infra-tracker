import express from 'express'
import cors from 'cors'

import universityRoutes from './routes/universities.js'
import spaceRoutes from './routes/spaces.js'
import checklistRoutes from './routes/checklist.js'
import statusRoutes from './routes/status.js'
import dashboardRoutes from './routes/dashboard.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '200mb' }))
app.use(express.urlencoded({ limit: '200mb', extended: true }))

app.use('/universities', universityRoutes)
app.use('/spaces', spaceRoutes)
app.use('/checklist', checklistRoutes)
app.use('/status', statusRoutes)
app.use('/dashboard', dashboardRoutes)

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
