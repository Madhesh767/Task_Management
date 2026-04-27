-- MySQL Database Schema for Task Management System

-- Create database
CREATE DATABASE IF NOT EXISTS taskmanagement;
USE taskmanagement;

-- Users table (for authentication)
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('Admin', 'Manager', 'Member') DEFAULT 'Member',
    status ENUM('Active', 'Away', 'Offline') DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Team members table
CREATE TABLE team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    role ENUM('Admin', 'Manager', 'Member') DEFAULT 'Member',
    status ENUM('Active', 'Away', 'Offline') DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tasks table
CREATE TABLE tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assignee_id INT,
    priority ENUM('High', 'Medium', 'Low') DEFAULT 'Medium',
    status ENUM('To Do', 'In Progress', 'Review', 'Done') DEFAULT 'To Do',
    due_date DATE,
    tags VARCHAR(500),
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (assignee_id) REFERENCES team_members(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Activity history table
CREATE TABLE activity_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT,
    action VARCHAR(50) NOT NULL,
    task_title VARCHAR(255),
    description TEXT,
    action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES team_members(id) ON DELETE CASCADE
);

-- Notifications table
CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Insert sample data

-- Users (password is 'password123' hashed with bcrypt)
INSERT INTO users (name, email, password, role) VALUES
('Madhesh', 'madhesh@packforce.ai', '$2b$10$rQZ8qH6y0yX5hZ7y8qH6y0yX5hZ7y8qH6y0yX5hZ7y8qH6y0yX5hZ', 'Admin'),
('Mike Johnson', 'manager@company.com', '$2b$10$rQZ8qH6y0yX5hZ7y8qH6y0yX5hZ7y8qH6y0yX5hZ7y8qH6y0yX5hZ', 'Manager'),
('Emma Wilson', 'emma@company.com', '$2b$10$rQZ8qH6y0yX5hZ7y8qH6y0yX5hZ7y8qH6y0yX5hZ7y8qH6y0yX5hZ', 'Member');

-- Team members
INSERT INTO team_members (name, email, role, status) VALUES
('Sarah Chen', 'admin@company.com', 'Admin', 'Active'),
('Mike Johnson', 'manager@company.com', 'Manager', 'Active'),
('Emma Wilson', 'emma.w@company.com', 'Member', 'Away'),
('Alex Kumar', 'alex.k@company.com', 'Member', 'Active'),
('Lisa Park', 'lisa.p@company.com', 'Member', 'Offline'),
('David Brown', 'david.b@company.com', 'Member', 'Active');

-- Tasks
INSERT INTO tasks (title, description, assignee_id, priority, status, due_date, tags) VALUES
('Design new landing page', 'Create a new landing page design', 1, 'High', 'In Progress', '2026-04-15', 'Design,Frontend'),
('API integration for payments', 'Integrate payment gateway APIs', 2, 'High', 'To Do', '2026-04-14', 'Backend'),
('Update user dashboard', 'Update the user dashboard UI', 3, 'Medium', 'In Progress', '2026-04-16', 'Frontend'),
('Write test cases', 'Write unit tests for new features', 4, 'Medium', 'To Do', '2026-04-18', 'Testing'),
('Fix authentication bug', 'Fix OAuth login issues', 5, 'High', 'Review', '2026-04-13', 'Bug'),
('Mobile responsive fixes', 'Fix layout issues on mobile', 1, 'Medium', 'In Progress', '2026-04-17', 'Frontend'),
('Code review PR #234', 'Review pull request for new API', 2, 'Low', 'Review', '2026-04-14', 'Review'),
('Dark mode implementation', 'Implement dark mode theme', 3, 'Low', 'Done', '2026-04-12', 'UI'),
('Database migration script', 'Create migration script for new schema', 4, 'High', 'To Do', '2026-04-19', 'Backend'),
('API documentation update', 'Update API documentation', 5, 'Medium', 'Done', '2026-04-11', 'Docs'),
('Performance optimization', 'Optimize database queries', 6, 'High', 'In Progress', '2026-04-20', 'Backend'),
('Security audit review', 'Review security audit results', 1, 'High', 'Review', '2026-04-21', 'Security');

-- Activity history
INSERT INTO activity_history (member_id, action, task_title, description) VALUES
(1, 'Completed', 'Design homepage mockups', 'Design homepage mockups completed'),
(1, 'Moved', 'Update brand guidelines to Review', 'Task moved to review'),
(2, 'Completed', 'API documentation', 'API documentation completed'),
(3, 'Completed', 'Dark mode implementation', 'Dark mode implementation done'),
(4, 'Completed', 'Unit tests for auth module', 'Unit tests completed');

-- Notifications
INSERT INTO notifications (user_id, title, message) VALUES
(1, 'New Task Assigned', 'You have been assigned a new task: Design new landing page'),
(2, 'Task Completed', 'Emma Wilson completed Dark mode implementation'),
(3, 'Task Updated', 'Your task Update user dashboard has been updated');
