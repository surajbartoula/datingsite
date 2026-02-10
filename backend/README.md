# Matcha Backend - Dating Application API

A comprehensive dating application backend with real-time chat, matching algorithm, and social interactions.

## Features

- ✅ **Authentication**: Email verification, JWT-based auth, password reset
- ✅ **Profile Management**: Image uploads (up to 5), tags, location, biography
- ✅ **Matching Algorithm**: Sexual compatibility, proximity-based, fame rating
- ✅ **Social Interactions**: Likes, blocks, reports, profile visits
- ✅ **Advanced Search**: Age, location, fame rating, tags filters
- ✅ **Real-time Chat**: Socket.io powered messaging with typing indicators
- ✅ **Real-time Notifications**: Live updates for likes, visits, matches, messages
- ✅ **Fame Rating System**: Dynamic reputation based on interactions

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL (raw pg driver, no ORM)
- **Real-time**: Socket.io
- **Authentication**: JWT (httpOnly cookies)
- **Password Hashing**: bcrypt
- **Email**: nodemailer
- **File Upload**: multer
- **Password Validation**: bad-words library

## Project Structure

```
backend/
├── routes/
│   ├── auth.js              # Authentication endpoints
│   ├── profile.js           # Profile CRUD + images
│   ├── browse.js            # Suggestions & search
│   ├── users.js             # Likes, blocks, reports, profile viewing
│   ├── chat.js              # Message history
│   └── notifications.js     # Notification management
├── middleware/
│   ├── authMiddleware.js    # JWT verification
│   └── errorHandler.js      # Centralized error handling
├── db/
│   ├── pool.js              # PostgreSQL connection pool
│   └── schema.sql           # Database schema
├── socket/
│   └── socketHandler.js     # Socket.io event handlers
├── utils/
│   ├── passwordValidator.js # Password strength validation
│   ├── emailService.js      # Email sending functions
│   └── fameRating.js        # Fame rating calculation
├── scripts/
│   └── initDatabase.js      # Database initialization script
├── uploads/                 # Uploaded images directory
├── server.js                # Main application entry point
├── package.json
├── .env.example
└── README.md
```

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Installation

### 1. Clone and Install Dependencies

```bash
npm install
```

### 2. Database Setup

Create a PostgreSQL database:

```bash
psql -U postgres
CREATE DATABASE matcha;
\q
```

### 3. Environment Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Update the `.env` file with your configuration:

```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=matcha
DB_USER=postgres
DB_PASSWORD=your_password

JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d

EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=Matcha <noreply@matcha.com>

MAX_FILE_SIZE=5242880
UPLOAD_DIR=uploads
```

### 4. Initialize Database

Run the database initialization script to create all tables:

```bash
npm run init-db
```

### 5. Start the Server

Development mode (with auto-restart):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on `http://localhost:5000`

## API Documentation

### Authentication Routes

#### POST /api/auth/register
Register a new user with email verification.

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "firstName": "John",
  "lastName": "Doe",
  "password": "SecurePass123!"
}
```

**Response:** `201 Created`

---

#### GET /api/auth/verify/:token
Verify email address using token from verification email.

**Response:** `200 OK`

---

#### POST /api/auth/login
Login with email/username and password.

**Request Body:**
```json
{
  "emailOrUsername": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:** Sets httpOnly cookie and returns user data

---

#### POST /api/auth/logout
Logout current user (requires authentication).

---

#### POST /api/auth/forgot-password
Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

---

#### POST /api/auth/reset-password
Reset password using token.

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "newPassword": "NewSecurePass123!"
}
```

---

#### GET /api/auth/me
Get current authenticated user's profile.

### Profile Routes

#### GET /api/profile
Get current user's complete profile with images and tags.

---

#### PUT /api/profile
Update profile information.

**Request Body:**
```json
{
  "gender": "male",
  "sexualPreference": "female",
  "biography": "Software developer who loves hiking",
  "city": "San Francisco",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "locationConsent": true
}
```

---

#### POST /api/profile/tags
Update user tags.

**Request Body:**
```json
{
  "tags": ["hiking", "coding", "coffee", "travel"]
}
```

---

#### GET /api/profile/tags/search?query=hik
Search for existing tags (autocomplete).

---

#### POST /api/profile/images
Upload an image (multipart/form-data).

**Form Data:**
- `image`: Image file (max 5MB, jpg/png/gif)
- `isProfilePicture`: "true" or "false"

---

#### PUT /api/profile/images/:imageId/profile-picture
Set an image as profile picture.

---

#### DELETE /api/profile/images/:imageId
Delete an image.

### Browse & Search Routes

#### GET /api/browse/suggestions
Get suggested matches based on compatibility.

**Query Parameters:**
- `sortBy`: score | age | location | fame | tags
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 20)

---

#### GET /api/browse/search
Advanced search with filters.

**Query Parameters:**
- `ageMin`, `ageMax`: Age range
- `fameMin`, `fameMax`: Fame rating range
- `city`: City name (partial match)
- `maxDistance`: Maximum distance in km
- `tags[]`: Array of tag names
- `sortBy`: score | age | location | fame | tags
- `page`, `limit`: Pagination

### User Interaction Routes

#### GET /api/users/:id
View another user's profile (records visit).

---

#### POST /api/users/:id/like
Like a user. Returns `{ isMatch: true }` if mutual.

---

#### DELETE /api/users/:id/like
Unlike a user (disables chat if was matched).

---

#### POST /api/users/:id/block
Block a user (removes all interactions).

---

#### POST /api/users/:id/report
Report a user.

---

#### GET /api/users/:id/visitors
Get users who visited your profile.

---

#### GET /api/users/:id/likers
Get users who liked your profile.

---

#### GET /api/users/matches
Get all mutual matches.

### Chat Routes

#### GET /api/chat/:userId/messages
Get message history with a matched user.

---

#### GET /api/chat/conversations
Get all conversations with unread counts.

---

#### GET /api/chat/unread-count
Get total unread message count.

### Notification Routes

#### GET /api/notifications
Get all notifications.

**Query Parameters:**
- `limit`: Max notifications (default: 50)
- `offset`: Skip count (default: 0)

---

#### GET /api/notifications/unread-count
Get unread notification count.

---

#### PUT /api/notifications/:id/read
Mark a notification as read.

---

#### PUT /api/notifications/mark-all-read
Mark all notifications as read.

---

#### DELETE /api/notifications/:id
Delete a notification.

## Socket.io Events

### Client → Server

**`send_message`**
```javascript
socket.emit('send_message', {
  receiverId: 123,
  content: 'Hello!'
});
```

**`typing_start`**
```javascript
socket.emit('typing_start', { receiverId: 123 });
```

**`typing_stop`**
```javascript
socket.emit('typing_stop', { receiverId: 123 });
```

**`mark_messages_read`**
```javascript
socket.emit('mark_messages_read', { senderId: 123 });
```

### Server → Client

**`new_message`** - Receive new message
**`message_sent`** - Confirmation of sent message
**`new_notification`** - New notification (like, visit, match, unlike)
**`user_typing`** - User started typing
**`user_stopped_typing`** - User stopped typing
**`user_online`** - Match came online
**`user_offline`** - Match went offline
**`messages_read`** - Your messages were read
**`error`** - Error occurred

### Client Connection

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: {
    token: 'your-jwt-token'
  }
});

socket.on('new_message', (message) => {
  console.log('New message:', message);
});

socket.on('new_notification', (notification) => {
  console.log('New notification:', notification);
});
```

## Fame Rating Algorithm

Formula:
```
fame_rating = (total_likes * 3) + (total_visits * 1) - (total_unlikes * 2)
```

Automatically recalculated on:
- User receives a like (+3)
- User receives a visit (+1)
- User gets unliked (-2)

## Matching Algorithm

Matching score formula:
```
score = (proximity_score * 40%) + (shared_tags * 35%) + (fame_rating * 25%)
```

**Proximity Score:**
- Same location: 40
- < 10km: 35
- < 50km: 30
- < 100km: 20
- < 500km: 10
- > 500km: 5

**Filters Applied:**
- Sexual compatibility (both ways)
- Excludes already liked users
- Excludes blocked users
- Excludes self

## Password Validation

Requirements:
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character
- Not in common password list
- Not containing profanity

## Security Features

- JWT stored in httpOnly cookies
- Password hashing with bcrypt
- SQL injection protection (parameterized queries)
- CORS protection
- Helmet security headers
- File upload validation
- Authentication required for protected routes

## Database Schema Highlights

**Key Tables:**
- `users` - Authentication and identity
- `profiles` - User profiles with location and preferences
- `tags` - Reusable interest tags
- `user_tags` - Many-to-many tag associations
- `images` - User photos (max 5 per user)
- `likes` - Like relationships
- `visits` - Profile visit history
- `blocks` - Block relationships
- `reports` - User reports
- `messages` - Chat messages
- `notifications` - Real-time notifications

All tables use proper foreign key constraints and indexes for performance.

## Error Handling

All routes use centralized error handling with proper status codes:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (blocked users, permission denied)
- `404` - Not Found
- `409` - Conflict (duplicate email/username)
- `500` - Internal Server Error

## Development Tips

**Testing with cURL:**

```bash
# Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","username":"testuser","firstName":"Test","lastName":"User","password":"Test123!"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"emailOrUsername":"testuser","password":"Test123!"}'

# Get profile (with cookie)
curl -X GET http://localhost:5000/api/profile \
  -b cookies.txt
```

**Reset Database:**
```bash
psql -U postgres -d matcha -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run init-db
```

## Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Use a strong `JWT_SECRET`
3. Configure proper email service (not Gmail)
4. Set up SSL/TLS certificates
5. Use a reverse proxy (nginx)
6. Set up proper PostgreSQL user permissions
7. Configure file upload to cloud storage (S3, Cloudinary)
8. Set up monitoring and logging
9. Enable rate limiting
10. Configure CORS for your frontend domain

## License

ISC
