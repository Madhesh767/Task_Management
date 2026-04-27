# Task Management System - Backend API

## Setup Instructions

### 1. MySQL Database Setup

First, create the database and tables by running the SQL script:

```bash
mysql -u root -p < schema.sql
```

Or manually execute the SQL commands in `schema.sql` in your MySQL client.

### 2. Configure Environment Variables

Edit `.env` file with your settings:

```env
# Server
PORT=3001

# MySQL Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=taskmanagement

# JWT Secret
JWT_SECRET=your-super-secret-key

# Gmail (Optional - for sending emails)
# 1. Enable 2-Factor Authentication
# 2. Generate App Password at: https://myaccount.google.com/apppasswords
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-16-char-app-password
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Server

```bash
npm start
```

Server will run on: `http://localhost:3001`

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/register` | User registration |
| GET | `/api/auth/me` | Get current user |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | Get all tasks |
| GET | `/api/tasks/:id` | Get single task |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |

### Team Members
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/team-members` | Get all members |
| GET | `/api/team-members/:id` | Get single member |
| POST | `/api/team-members` | Add member (Admin/Manager) |
| PUT | `/api/team-members/:id` | Update member |
| DELETE | `/api/team-members/:id` | Delete member |
| GET | `/api/team-members/:id/tasks` | Get member tasks |
| GET | `/api/team-members/:id/activity` | Get member activity |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Get notifications |
| PUT | `/api/notifications/:id/read` | Mark as read |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/stats` | Get dashboard statistics |

### Email
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/send-assignment-email` | Send task assignment email |

## Authentication

All API endpoints (except login) require authentication.

Include the JWT token in the Authorization header:

```
Authorization: Bearer <your_token>
```
