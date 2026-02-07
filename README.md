Tech Stack
Frontend: React, React Router v6, Socket.io-client, Axios
Backend: Node.js + Express
Database: PostgreSQL (raw pg driver, no ORM)
Real-time: Socket.io (chat + notifications)
Other: bcrypt (passwords), nodemailer (emails), multer (image uploads), jsonwebtoken (auth tokens), a dictionary wordlist file for password validation

Phase 1 — Project Setup & Auth
Set up your folder structure, initialize both frontend and backend projects. Configure PostgreSQL and write your schema (users, profiles, images, likes, blocks, reports, visits, messages, notifications, tags, user_tags tables). Implement registration with email/username/password, dictionary-based password rejection (download a wordlist like /usr/share/dict/words or a npm package like bad-words), send verification email via nodemailer with a unique token, and build the login flow using JWT stored in an httpOnly cookie. Add logout and password reset (email token-based) flows.

Phase 2 — Database Schema Design
Design all tables upfront before touching the frontend. Here's the core structure:

![alt text](database.png)

## Phase 3 — Profile CRUD

Build the profile completion and editing pages. Handle gender, sexual preference, bio, tags (with autocomplete that searches existing tags and allows creating new ones), location (GPS via browser `geolocation` API with consent toggle, or manual city input), and image uploads (up to 5, enforce one profile picture). Use `multer` on the backend to handle multipart uploads and store files (locally or on a service like Cloudinary). All profile updates go through Express routes that run raw `INSERT`/`UPDATE`/`DELETE` queries via `pg`.

---

## Phase 4 — Fame Rating Logic

Define and implement your fame rating formula. A straightforward consistent approach:

fame*rating = (total_likes_received * 3) + (total*visits_received * 1) - (total_unlikes_received \* 2)

Recalculate this via a helper function or a PostgreSQL view whenever a like, unlike, or visit event occurs. Store the result in `profiles.fame_rating`. This keeps it simple and consistent.

---

## Phase 5 — Browsing & Matching Algorithm

This is the core logic, and it lives on the backend. When a user requests their suggestion list, the query needs to:

1. **Filter by sexual compatibility** — a heterosexual woman sees only men, bisexual users see both, etc. This is a `WHERE` clause join between `users`, `profiles`, and checking both sides' preferences.
2. **Exclude** already-liked, blocked, and self profiles.
3. **Score and rank** each candidate using a weighted formula, for example:

score = (proximity*score * 40) + (shared*tags_count * 35) + (fame_rating_normalized \* 25)

Where `proximity_score` is inverse distance (closer = higher). Compute shared tags via a subquery counting matching rows in `user_tags`. Return results sorted by this score by default, but allow the frontend to override the sort to age, location, fame rating, or common tags.

4. **Filtering** (age range, location, fame rating range, tags) is applied as additional `WHERE`/`HAVING` clauses on the same query.

---

## Phase 6 — Profile Viewing, Likes, Blocks, Reports

Build the profile view page. When visited, insert a row into `visits` and create a `visit` notification. Show the target user's info (everything except email/password), their online status or last connection time, their fame rating, whether they liked you, and whether you're connected (mutual like). Add UI buttons for like/unlike, block, and report. A "like" inserts into the `likes` table; if the reverse like already exists, you're now connected — create a `match` notification for both users. An "unlike" deletes from `likes`, disables chat, and creates an `unlike` notification.

---

## Phase 7 — Advanced Search

Build a search page with filters for age range, fame rating range, location (city text match or radius from a point), and one or more tags. Construct the SQL query dynamically on the backend based on which filters the user actually submits (be careful with SQL injection — use parameterized queries with `pg`). Results use the same sort/filter options as browsing.

---

## Phase 8 — Real-Time: Chat & Notifications (Socket.io)

This is where Socket.io comes in. On the backend, set up a Socket.io server alongside Express. On the frontend, connect on login.

For **chat**: when two users are connected (mutual like), they can open a chat room. Messages are sent via Socket.io events, persisted to the `messages` table simultaneously, and relayed to the other user's socket. Show unread message count in a persistent nav indicator.

For **notifications**: whenever a like, visit, message, match, or unlike event occurs on the backend, emit a notification event to the target user's socket. The frontend listens for these events globally and updates an unread notification badge visible from every page. Notifications are also persisted to the `notifications` table so they survive page refreshes.

## Phase 9 — Polish & Edge Cases

Handle all the details: prevent liking if you have no profile picture, enforce the 5-image limit, make blocked users disappear from all searches and notifications, handle the GPS consent flow properly, ensure the chat is disabled when someone unlikes, validate everything on both frontend and backend, and add responsive styling.

## React Page/Component Structure

![alt text](frontend.png)

## Express Route Structure

![alt text](backend.png)

Build order summary: Schema → Auth → Profile CRUD → Fame rating → Browse/Match → Profile view + Likes/Blocks → Search → Socket.io (chat + notifications) → Polish. Each phase is independently testable before moving to the next.
