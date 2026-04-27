require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// CORS configuration
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'taskmanagement',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    return false;
  }
}

// Initialize database schema
async function initializeDatabase() {
  try {
    // Create database if not exists
    const tempPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      waitForConnections: true,
      connectionLimit: 10,
    });

    await tempPool.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'taskmanagement'}`);
    await tempPool.end();

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        role VARCHAR(50) DEFAULT 'Member',
        status VARCHAR(50) DEFAULT 'Active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'Member',
        status VARCHAR(50) DEFAULT 'Active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        assignee_id INT,
        priority VARCHAR(50) DEFAULT 'Medium',
        status VARCHAR(50) DEFAULT 'To Do',
        due_date DATETIME,
        tags TEXT,
        created_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (assignee_id) REFERENCES team_members(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        team_member_id INT,
        action VARCHAR(255) NOT NULL,
        task_title VARCHAR(255),
        description TEXT,
        action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (team_member_id) REFERENCES team_members(id)
      )
    `);

    // Add team_member_id column if it doesn't exist
    try {
      await pool.query('ALTER TABLE activity_history ADD COLUMN team_member_id INT');
    } catch (e) {
      // Column may already exist
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_id INT,
        team_member_id INT,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (team_member_id) REFERENCES team_members(id)
      )
    `);

    // Add team_member_id column if it doesn't exist
    try {
      await pool.query('ALTER TABLE task_comments ADD COLUMN team_member_id INT');
    } catch (e) {
      // Column may already exist
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_id INT,
        user_id INT,
        filename VARCHAR(255) NOT NULL,
        filepath VARCHAR(500) NOT NULL,
        filesize INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Seed default user if not exists
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminName = process.env.ADMIN_NAME || 'Admin';
    const adminRole = process.env.ADMIN_ROLE || 'Manager';

    const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (existingUsers.length === 0) {
      const hashedPassword = bcrypt.hashSync(adminPassword, 10);
      await pool.query(
        'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
        [adminName, adminEmail, hashedPassword, adminRole, 'Active']
      );
      console.log(`✅ Default user created: ${adminEmail} / ${adminPassword}`);
    }

    console.log('✅ MySQL database initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
  }
}

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Auth middleware
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

// ==================== AUTH ROUTES ====================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const [users] = await pool.query('SELECT id, name, email, password, role, status FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = users[0];

    if (!password) {
      return res.status(401).json({ error: 'Password required' });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('Email for team member lookup:', email);
    const [teamMembers] = await pool.query('SELECT id FROM team_members WHERE email = ?', [email]);
    console.log('Found team members:', teamMembers);
    const teamMemberId = teamMembers.length > 0 ? teamMembers[0].id : null;

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
    console.log('Register request body:', req.body);
    
    const { name, email, password, role = 'Member' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    console.log('Existing user check:', existing);
    
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, role]
    );

    await pool.query(
      'INSERT INTO team_members (name, email, role, status) VALUES (?, ?, ?, ?)',
      [name, email, role, 'Active']
    );

    console.log('User created:', result);
    res.status(201).json({ message: 'User created successfully', userId: result.insertId });
  } catch (error) {
    console.error('Registration error:', error.message, error.code);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, email, role, status FROM users WHERE id = ?', [req.user.id]);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
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

// ==================== TASKS ROUTES ====================

app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const [tasks] = await pool.query(`
      SELECT t.*, tm.name as assignee_name, tm.email as assignee_email, u.name as creator_name
      FROM tasks t
      LEFT JOIN team_members tm ON t.assignee_id = tm.id
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC
    `);

    const formattedTasks = tasks.map(task => ({
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
    const [tasks] = await pool.query(`
      SELECT t.*, tm.name as assignee_name, u.name as creator_name
      FROM tasks t
      LEFT JOIN team_members tm ON t.assignee_id = tm.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.id = ?
    `, [taskId]);

    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = tasks[0];
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
      formattedDueDate = new Date(dueDate).toISOString().slice(0, 19).replace('T', ' ');
    }

    const [result] = await pool.query(
      `INSERT INTO tasks (title, description, assignee_id, priority, status, due_date, tags, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, assigneeId || null, priority || 'Medium', status || 'To Do', formattedDueDate, tags || '', req.user.id]
    );

    if (assigneeId) {
      await pool.query(
        'INSERT INTO activity_history (user_id, action, task_title, description) VALUES (?, ?, ?, ?)',
        [assigneeId, 'Created', title, `New task assigned: ${title}`]
      );
    }

    res.status(201).json({ message: 'Task created successfully', taskId: result.insertId });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const updates = req.body;
    const taskId = parseInt(req.params.id);

    const [oldTask] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (oldTask.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const fields = [];
    const values = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.assigneeId !== undefined) {
      fields.push('assignee_id = ?');
      values.push(updates.assigneeId || null);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.dueDate !== undefined) {
      fields.push('due_date = ?');
      let formattedDate = null;
      if (updates.dueDate) {
        const dateObj = new Date(updates.dueDate);
        if (!isNaN(dateObj.getTime())) {
          formattedDate = dateObj.toISOString().slice(0, 19).replace('T', ' ');
        }
      }
      values.push(formattedDate);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(Array.isArray(updates.tags) ? updates.tags.join(',') : updates.tags);
    }

    if (fields.length > 0) {
      values.push(taskId);
      try {
        console.log('UPDATE SQL:', `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`);
        console.log('Values:', values);
        await pool.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
      } catch (err) {
        console.error('Update error:', err);
        throw err;
      }
    }

    const newStatus = updates.status || oldTask[0].status;
    if (oldTask[0].status !== newStatus && updates.assigneeId) {
      try {
        await pool.query(
          'INSERT INTO activity_history (user_id, action, task_title, description) VALUES (?, ?, ?, ?)',
          [updates.assigneeId, 'Moved', oldTask[0].title, `Task moved from ${oldTask[0].status} to ${newStatus}`]
        );
      } catch (e) {
        console.error('Activity insert error:', e);
      }
    }

    const [tasks] = await pool.query(`
      SELECT t.*, tm.name as assignee_name, u.name as creator_name
      FROM tasks t
      LEFT JOIN team_members tm ON t.assignee_id = tm.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.id = ?
    `, [taskId]);
    const task = tasks[0];
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
    await pool.query('DELETE FROM tasks WHERE id = ?', [taskId]);
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ==================== TASK COMMENTS ROUTES ====================

app.get('/api/tasks/:id/comments', authenticateToken, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    console.log('Getting comments for task:', taskId);
    const [comments] = await pool.query(`
      SELECT tc.id, tc.task_id, tc.team_member_id, tc.content, tc.created_at, tm.name as author_name
      FROM task_comments tc
      LEFT JOIN team_members tm ON tc.team_member_id = tm.id
      WHERE tc.task_id = ?
      ORDER BY tc.created_at ASC
    `, [taskId]);
    console.log('Comments found:', comments.length);

    res.json(comments.map(c => ({
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
    console.log('Adding comment - taskId:', taskId, 'memberId:', memberId, 'content:', content);

    const [result] = await pool.query(
      'INSERT INTO task_comments (task_id, team_member_id, content) VALUES (?, ?, ?)',
      [taskId, memberId, content]
    );
    console.log('Insert result:', result);

    if (!result.insertId) {
      return res.status(201).json({
        id: Date.now(),
        author: 'You',
        authorInitials: 'Y',
        content: content,
        time: new Date().toISOString(),
      });
    }

    const [comments] = await pool.query(`
      SELECT tc.id, tc.task_id, tc.team_member_id, tc.content, tc.created_at, tm.name as author_name
      FROM task_comments tc
      LEFT JOIN team_members tm ON tc.team_member_id = tm.id
      WHERE tc.id = ?
    `, [result.insertId]);
    console.log('Inserted comment:', comments[0]);

    const comment = comments[0];
    if (!comment) {
      return res.status(201).json({
        id: result.insertId,
        author: 'You',
        authorInitials: 'Y',
        content: content,
        time: new Date().toISOString(),
      });
    }

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

// ==================== TASK ATTACHMENTS ROUTES ====================

app.get('/api/tasks/:id/attachments', authenticateToken, async (req, res) => {
  try {
    const [attachments] = await pool.query(`
      SELECT ta.*, u.name as uploader_name
      FROM task_attachments ta
      LEFT JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id = ?
      ORDER BY ta.created_at DESC
    `, [parseInt(req.params.id)]);

    res.json(attachments.map(a => ({
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
    const [result] = await pool.query(
      'INSERT INTO task_attachments (task_id, user_id, filename, filepath, filesize) VALUES (?, ?, ?, ?, ?)',
      [taskId, req.user.id, filename, filepath, filesize || 0]
    );

    res.status(201).json({ id: result.insertId, message: 'Attachment added' });
  } catch (error) {
    console.error('Add attachment error:', error);
    res.status(500).json({ error: 'Failed to add attachment' });
  }
});

// ==================== TEAM MEMBERS ROUTES ====================

app.get('/api/team-members', authenticateToken, async (req, res) => {
  try {
    const [members] = await pool.query(`
      SELECT tm.*, (SELECT COUNT(*) FROM tasks WHERE assignee_id = tm.id AND status != 'Done') as tasks_count
      FROM team_members tm
      ORDER BY tm.name
    `);

    const formattedMembers = members.map(member => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
      tasksCount: member.tasks_count,
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
    const [members] = await pool.query(`
      SELECT tm.*, (SELECT COUNT(*) FROM tasks WHERE assignee_id = tm.id AND status != 'Done') as tasks_count
      FROM team_members tm
      WHERE tm.id = ?
    `, [parseInt(req.params.id)]);

    if (members.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    const member = members[0];
    res.json({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
      tasksCount: member.tasks_count,
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

    const [result] = await pool.query('INSERT INTO team_members (name, email, role) VALUES (?, ?, ?)', [name, email, role || 'Member']);

    const hashedPassword = bcrypt.hashSync(password || 'password123', 10);
    await pool.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [name, email, hashedPassword, role || 'Member']);

    res.status(201).json({ message: 'Team member added successfully', memberId: result.insertId });
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
    await pool.query('UPDATE team_members SET name = ?, email = ?, role = ?, status = ? WHERE id = ?', [name, email, role, status, memberId]);

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
    await pool.query('DELETE FROM team_members WHERE id = ?', [memberId]);
    res.json({ message: 'Team member deleted successfully' });
  } catch (error) {
    console.error('Delete team member error:', error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
});

app.get('/api/team-members/:id/tasks', authenticateToken, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    const [tasks] = await pool.query('SELECT * FROM tasks WHERE assignee_id = ? ORDER BY created_at DESC', [memberId]);
    res.json(tasks.map(task => ({
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
    console.log('Getting activity for member:', memberId);
    const [activities] = await pool.query('SELECT * FROM activity_history WHERE team_member_id = ? ORDER BY action_date DESC LIMIT 20', [memberId]);
    console.log('Activities found:', activities.length);
    res.json(activities.map(activity => ({
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

// ==================== NOTIFICATIONS ROUTES ====================

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const [notifications] = await pool.query('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.id);
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [notificationId, req.user.id]);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// ==================== EMAIL ROUTE ====================

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

// ==================== DASHBOARD STATS ====================

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const [taskStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'To Do' THEN 1 ELSE 0 END) as todo_count,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN status = 'Review' THEN 1 ELSE 0 END) as review_count,
        SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) as done_count,
        SUM(CASE WHEN priority = 'High' AND status != 'Done' THEN 1 ELSE 0 END) as high_priority_count
      FROM tasks
    `);

    const [memberStats] = await pool.query(`
      SELECT COUNT(*) as total_members, SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active_count
      FROM team_members
    `);

    const workloadData = [
      { name: 'Mon', tasks: Math.floor(Math.random() * 15) + 5 },
      { name: 'Tue', tasks: Math.floor(Math.random() * 15) + 5 },
      { name: 'Wed', tasks: Math.floor(Math.random() * 15) + 5 },
      { name: 'Thu', tasks: Math.floor(Math.random() * 15) + 5 },
      { name: 'Fri', tasks: Math.floor(Math.random() * 15) + 5 },
      { name: 'Sat', tasks: Math.floor(Math.random() * 10) },
      { name: 'Sun', tasks: Math.floor(Math.random() * 5) },
    ];

    const activityData = [
      { name: 'Week 1', completed: taskStats[0].done_count || 0 },
      { name: 'Week 2', completed: Math.floor((taskStats[0].done_count || 0) * 0.8) },
      { name: 'Week 3', completed: Math.floor((taskStats[0].done_count || 0) * 0.6) },
      { name: 'Week 4', completed: Math.floor((taskStats[0].done_count || 0) * 0.4) },
    ];

    res.json({
      totalTasks: taskStats[0].total_tasks || 0,
      inProgress: taskStats[0].in_progress_count || 0,
      completed: taskStats[0].done_count || 0,
      overdue: taskStats[0].high_priority_count || 0,
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

// Start server
async function startServer() {
  const connected = await testConnection();
  if (connected) {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
    });
  } else {
    console.log('❌ Please check your MySQL credentials in .env file');
  }
}

startServer();
