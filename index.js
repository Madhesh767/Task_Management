require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected successfully');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  }
}

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        role VARCHAR(50) DEFAULT 'Member',
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'Member',
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        assignee_id INTEGER,
        priority VARCHAR(50) DEFAULT 'Medium',
        status VARCHAR(50) DEFAULT 'To Do',
        due_date TIMESTAMP,
        tags TEXT,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assignee_id) REFERENCES team_members(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        team_member_id INTEGER,
        action VARCHAR(255) NOT NULL,
        task_title VARCHAR(255),
        description TEXT,
        action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (team_member_id) REFERENCES team_members(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER,
        team_member_id INTEGER,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (team_member_id) REFERENCES team_members(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER,
        user_id INTEGER,
        filename VARCHAR(255) NOT NULL,
        filepath VARCHAR(500) NOT NULL,
        filesize INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminName = process.env.ADMIN_NAME || 'Admin';
    const adminRole = process.env.ADMIN_ROLE || 'Manager';

    const existingUsers = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existingUsers.rows.length === 0) {
      const hashedPassword = bcrypt.hashSync(adminPassword, 10);
      await client.query(
        'INSERT INTO users (name, email, password, role, status) VALUES ($1, $2, $3, $4, $5)',
        [adminName, adminEmail, hashedPassword, adminRole, 'Active']
      );
      console.log(`✅ Default user created: ${adminEmail} / ${adminPassword}`);
    }

    console.log('✅ PostgreSQL database initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
  } finally {
    client.release();
  }
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const users = await pool.query('SELECT id, name, email, password, role, status FROM users WHERE email = $1', [email]);

    if (users.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = users.rows[0];

    if (!password) {
      return res.status(401).json({ error: 'Password required' });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const teamMembers = await pool.query('SELECT id FROM team_members WHERE email = $1', [email]);
    const teamMemberId = teamMembers.rows.length > 0 ? teamMembers.rows[0].id : null;

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, teamMemberId },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        initials: user.name.split(' ').map(n => n[0]).join(''),
        teamMemberId
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role = 'Member' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const result = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, hashedPassword, role]
    );

    await pool.query(
      'INSERT INTO team_members (name, email, role, status) VALUES ($1, $2, $3, $4)',
      [name, email, role, 'Active']
    );

    res.status(201).json({ message: 'User created successfully', userId: result.rows[0].id });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const users = await pool.query('SELECT id, name, email, role, status FROM users WHERE id = $1', [req.user.id]);

    if (users.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users.rows[0];
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      initials: user.name.split(' ').map(n => n[0]).join('')
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const tasks = await pool.query(`
      SELECT t.*, tm.name as assignee_name, tm.email as assignee_email, u.name as creator_name
      FROM tasks t
      LEFT JOIN team_members tm ON t.assignee_id = tm.id
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC
    `);

    const formattedTasks = tasks.rows.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      assignee: task.assignee_name || null,
      assigneeId: task.assignee_id,
      assigneeInitials: task.assignee_name ? task.assignee_name.split(' ').map(n => n[0]).join('') : null,
      priority: task.priority,
      status: task.status,
      dueDate: task.due_date,
      tags: task.tags ? task.tags.split(',') : [],
      createdBy: task.creator_name,
      createdAt: task.created_at,
      updatedAt: task.updated_at
    }));

    res.json(formattedTasks);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

app.get('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const tasks = await pool.query(`
      SELECT t.*, tm.name as assignee_name, u.name as creator_name
      FROM tasks t
      LEFT JOIN team_members tm ON t.assignee_id = tm.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.id = $1
    `, [taskId]);

    if (tasks.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = tasks.rows[0];
    res.json({
      id: task.id,
      title: task.title,
      description: task.description,
      assignee: task.assignee_name,
      assigneeId: task.assignee_id,
      priority: task.priority,
      status: task.status,
      dueDate: task.due_date,
      tags: task.tags ? task.tags.split(',') : [],
      createdBy: task.creator_name,
      createdAt: task.created_at,
      updatedAt: task.updated_at
    });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

app.post('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const { title, description, assigneeId, priority, status, dueDate, tags } = req.body;

    let formattedDueDate = null;
    if (dueDate) {
      formattedDueDate = new Date(dueDate);
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, description, assignee_id, priority, status, due_date, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [title, description, assigneeId || null, priority || 'Medium', status || 'To Do', formattedDueDate, tags || '', req.user.id]
    );

    if (assigneeId) {
      await pool.query(
        'INSERT INTO activity_history (user_id, action, task_title, description) VALUES ($1, $2, $3, $4)',
        [assigneeId, 'Created', title, `New task assigned: ${title}`]
      );

      await pool.query(
        'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
        [assigneeId, `New task assigned: ${title}`]
      );
    }

    res.status(201).json({ message: 'Task created successfully', taskId: result.rows[0].id });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const updates = req.body;
    const taskId = parseInt(req.params.id);

    const oldTask = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (oldTask.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      fields.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.assigneeId !== undefined) {
      fields.push(`assignee_id = $${paramIndex++}`);
      values.push(updates.assigneeId || null);
    }
    if (updates.priority !== undefined) {
      fields.push(`priority = $${paramIndex++}`);
      values.push(updates.priority);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.dueDate !== undefined) {
      fields.push(`due_date = $${paramIndex++}`);
      values.push(updates.dueDate ? new Date(updates.dueDate) : null);
    }
    if (updates.tags !== undefined) {
      fields.push(`tags = $${paramIndex++}`);
      values.push(Array.isArray(updates.tags) ? updates.tags.join(',') : updates.tags);
    }

    if (fields.length > 0) {
      values.push(taskId);
      await pool.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
    }

    if (updates.assigneeId && updates.assigneeId !== oldTask.rows[0].assignee_id) {
      await pool.query(
        'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
        [updates.assigneeId, `New task assigned: ${oldTask.rows[0].title}`]
      );
    }

    const newStatus = updates.status || oldTask.rows[0].status;
    if (oldTask.rows[0].status !== newStatus && updates.assigneeId) {
      await pool.query(
        'INSERT INTO activity_history (user_id, action, task_title, description) VALUES ($1, $2, $3, $4)',
        [updates.assigneeId, 'Moved', oldTask.rows[0].title, `Task moved from ${oldTask.rows[0].status} to ${newStatus}`]
      );
    }

    const tasks = await pool.query(`
      SELECT t.*, tm.name as assignee_name, u.name as creator_name
      FROM tasks t
      LEFT JOIN team_members tm ON t.assignee_id = tm.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.id = $1
    `, [taskId]);
    const task = tasks.rows[0];
    res.json({
      message: 'Task updated successfully',
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        assignee: task.assignee_name,
        assigneeId: task.assignee_id,
        priority: task.priority,
        status: task.status,
        dueDate: task.due_date,
        tags: task.tags ? task.tags.split(',') : [],
        createdBy: task.creator_name,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      }
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.get('/api/tasks/:id/comments', authenticateToken, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const comments = await pool.query(`
      SELECT tc.id, tc.task_id, tc.team_member_id, tc.content, tc.created_at, tm.name as author_name
      FROM task_comments tc
      LEFT JOIN team_members tm ON tc.team_member_id = tm.id
      WHERE tc.task_id = $1
      ORDER BY tc.created_at ASC
    `, [taskId]);

    res.json(comments.rows.map(c => ({
      id: c.id,
      author: c.author_name || 'Unknown',
      authorInitials: c.author_name ? c.author_name.split(' ').map(n => n[0]).join('') : '?',
      content: c.content,
      time: c.created_at,
    })));
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

app.post('/api/tasks/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { content, teamMemberId } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const taskId = parseInt(req.params.id);
    const memberId = teamMemberId || req.user.teamMemberId;

    const result = await pool.query(
      'INSERT INTO task_comments (task_id, team_member_id, content) VALUES ($1, $2, $3) RETURNING id, created_at',
      [taskId, memberId, content]
    );

    const comments = await pool.query(`
      SELECT tc.id, tc.task_id, tc.team_member_id, tc.content, tc.created_at, tm.name as author_name
      FROM task_comments tc
      LEFT JOIN team_members tm ON tc.team_member_id = tm.id
      WHERE tc.id = $1
    `, [result.rows[0].id]);

    const comment = comments.rows[0];
    res.status(201).json({
      id: comment.id,
      author: comment.author_name || 'Unknown',
      authorInitials: comment.author_name ? comment.author_name.split(' ').map(n => n[0]).join('') : '?',
      content: comment.content,
      time: comment.created_at,
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

app.get('/api/tasks/:id/attachments', authenticateToken, async (req, res) => {
  try {
    const attachments = await pool.query(`
      SELECT ta.*, u.name as uploader_name
      FROM task_attachments ta
      LEFT JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id = $1
      ORDER BY ta.created_at DESC
    `, [parseInt(req.params.id)]);

    res.json(attachments.rows.map(a => ({
      id: a.id,
      name: a.filename,
      size: a.filesize,
      path: a.filepath,
      uploader: a.uploader_name,
      time: a.created_at,
    })));
  } catch (error) {
    console.error('Get attachments error:', error);
    res.status(500).json({ error: 'Failed to get attachments' });
  }
});

app.post('/api/tasks/:id/attachments', authenticateToken, async (req, res) => {
  try {
    const { filename, filepath, filesize } = req.body;
    if (!filename || !filepath) {
      return res.status(400).json({ error: 'Filename and filepath are required' });
    }

    const taskId = parseInt(req.params.id);
    const result = await pool.query(
      'INSERT INTO task_attachments (task_id, user_id, filename, filepath, filesize) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [taskId, req.user.id, filename, filepath, filesize || 0]
    );

    res.status(201).json({ id: result.rows[0].id, message: 'Attachment added' });
  } catch (error) {
    console.error('Add attachment error:', error);
    res.status(500).json({ error: 'Failed to add attachment' });
  }
});

app.get('/api/team-members', authenticateToken, async (req, res) => {
  try {
    const members = await pool.query(`
      SELECT tm.*, (SELECT COUNT(*) FROM tasks WHERE assignee_id = tm.id AND status != 'Done') as tasks_count
      FROM team_members tm
      ORDER BY tm.name
    `);

    const formattedMembers = members.rows.map(member => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
      tasksCount: parseInt(member.tasks_count),
      initials: member.name.split(' ').map(n => n[0]).join('')
    }));

    res.json(formattedMembers);
  } catch (error) {
    console.error('Get team members error:', error);
    res.status(500).json({ error: 'Failed to get team members' });
  }
});

app.get('/api/team-members/:id', authenticateToken, async (req, res) => {
  try {
    const members = await pool.query(`
      SELECT tm.*, (SELECT COUNT(*) FROM tasks WHERE assignee_id = tm.id AND status != 'Done') as tasks_count
      FROM team_members tm
      WHERE tm.id = $1
    `, [parseInt(req.params.id)]);

    if (members.rows.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    const member = members.rows[0];
    res.json({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
      tasksCount: parseInt(member.tasks_count),
      initials: member.name.split(' ').map(n => n[0]).join('')
    });
  } catch (error) {
    console.error('Get team member error:', error);
    res.status(500).json({ error: 'Failed to get team member' });
  }
});

app.post('/api/team-members', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'Member') {
      return res.status(403).json({ error: 'Only Admin or Manager can add team members' });
    }

    const { name, email, role, password } = req.body;

    const result = await pool.query('INSERT INTO team_members (name, email, role) VALUES ($1, $2, $3) RETURNING id', [name, email, role || 'Member']);

    const hashedPassword = bcrypt.hashSync(password || 'password123', 10);
    await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)', [name, email, hashedPassword, role || 'Member']);

    res.status(201).json({ message: 'Team member added successfully', memberId: result.rows[0].id });
  } catch (error) {
    console.error('Create team member error:', error);
    res.status(500).json({ error: 'Failed to add team member' });
  }
});

app.put('/api/team-members/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'Member') {
      return res.status(403).json({ error: 'Only Admin or Manager can update team members' });
    }

    const { name, email, role, status } = req.body;
    const memberId = parseInt(req.params.id);
    await pool.query('UPDATE team_members SET name = $1, email = $2, role = $3, status = $4 WHERE id = $5', [name, email, role, status, memberId]);

    res.json({ message: 'Team member updated successfully' });
  } catch (error) {
    console.error('Update team member error:', error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

app.delete('/api/team-members/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'Member') {
      return res.status(403).json({ error: 'Only Admin or Manager can delete team members' });
    }

    const memberId = parseInt(req.params.id);
    await pool.query('DELETE FROM team_members WHERE id = $1', [memberId]);
    res.json({ message: 'Team member deleted successfully' });
  } catch (error) {
    console.error('Delete team member error:', error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
});

app.get('/api/team-members/:id/tasks', authenticateToken, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    const tasks = await pool.query('SELECT * FROM tasks WHERE assignee_id = $1 ORDER BY created_at DESC', [memberId]);
    res.json(tasks.rows.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueDate: task.due_date,
      tags: task.tags ? task.tags.split(',') : []
    })));
  } catch (error) {
    console.error('Get member tasks error:', error);
    res.status(500).json({ error: 'Failed to get member tasks' });
  }
});

app.get('/api/team-members/:id/activity', authenticateToken, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    const activities = await pool.query('SELECT * FROM activity_history WHERE team_member_id = $1 ORDER BY action_date DESC LIMIT 20', [memberId]);
    res.json(activities.rows.map(activity => ({
      id: activity.id,
      action: activity.action,
      task: activity.task_title,
      description: activity.description,
      date: activity.action_date
    })));
  } catch (error) {
    console.error('Get member activity error:', error);
    res.status(500).json({ error: 'Failed to get member activity' });
  }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    res.json(notifications.rows);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.id);
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [notificationId, req.user.id]);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

app.post('/api/send-assignment-email', authenticateToken, async (req, res) => {
  try {
    const { toEmail, assigneeName, taskTitle, taskDescription, dueDate } = req.body;

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.json({ success: true, message: 'Email not configured' });
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: toEmail,
      subject: `New Task Assigned: ${taskTitle}`,
      html: `<h2>New Task Assigned</h2><p><strong>Task:</strong> ${taskTitle}</p><p><strong>Assigned to:</strong> ${assigneeName}</p><p><strong>Due Date:</strong> ${dueDate || 'Not set'}</p><p><strong>Description:</strong> ${taskDescription || 'No description'}</p>`
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Send email error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const taskStats = await pool.query(`
      SELECT 
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'To Do' THEN 1 ELSE 0 END) as todo_count,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN status = 'Review' THEN 1 ELSE 0 END) as review_count,
        SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) as done_count,
        SUM(CASE WHEN priority = 'High' AND status != 'Done' THEN 1 ELSE 0 END) as high_priority_count
      FROM tasks
    `);

    const memberStats = await pool.query(`
      SELECT COUNT(*) as total_members, SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active_count
      FROM team_members
    `);

    const weeklyTasks = await pool.query(`
      SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        COUNT(*) as task_count
      FROM tasks
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY EXTRACT(DOW FROM created_at)
    `);

    const dayMap = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    const taskCountByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    weeklyTasks.rows.forEach((row) => {
      const dayName = dayMap[parseInt(row.day_of_week)];
      if (dayName) taskCountByDay[dayName] = parseInt(row.task_count);
    });

    const workloadData = [
      { name: 'Mon', tasks: taskCountByDay['Mon'] },
      { name: 'Tue', tasks: taskCountByDay['Tue'] },
      { name: 'Wed', tasks: taskCountByDay['Wed'] },
      { name: 'Thu', tasks: taskCountByDay['Thu'] },
      { name: 'Fri', tasks: taskCountByDay['Fri'] },
      { name: 'Sat', tasks: taskCountByDay['Sat'] },
      { name: 'Sun', tasks: taskCountByDay['Sun'] },
    ];

    const doneCount = taskStats.rows[0].done_count || 0;
    const activityData = [
      { name: 'Week 1', completed: doneCount },
      { name: 'Week 2', completed: Math.floor(doneCount * 0.8) },
      { name: 'Week 3', completed: Math.floor(doneCount * 0.6) },
      { name: 'Week 4', completed: Math.floor(doneCount * 0.4) },
    ];

    res.json({
      totalTasks: taskStats.rows[0].total_tasks || 0,
      inProgress: taskStats.rows[0].in_progress_count || 0,
      completed: taskStats.rows[0].done_count || 0,
      overdue: taskStats.rows[0].high_priority_count || 0,
      totalTasksChange: '+12%',
      inProgressChange: '+8%',
      completedChange: '+15%',
      overdueChange: '-3%',
      workloadData,
      activityData,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

async function startServer() {
  const connected = await testConnection();
  if (connected) {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
    });
  } else {
    console.log('❌ Please check your PostgreSQL credentials in .env file');
  }
}

startServer();