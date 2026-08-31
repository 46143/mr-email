Temporary Email Discord Bot
Node.JS/JavaScript

A Discord bot that generates temporary email addresses directly in DMs using the Mail.tm API.

Features

- Generate temporary email addresses with custom domain selection
- Login to existing emails to check inbox
- View messages (up to 5 most recent)
- Read specific emails with automatic security code extraction
- Latest email command for quick access
- Microsoft account creation link
- No cooldown restrictions
- Leaderboard tracking total emails generated
- Real-time bot presence showing total emails
- Works in DMs and servers
- Owner block/unblock system

Commands

/egen <domain> - Generate a temporary email address
/domains - Show available email domains
/login <email> <token> - Login to an existing temporary email
/inbox - View messages in your logged-in email inbox
/read <id> - Read a specific email message
/latest - Read the most recent email message
/microsoft - Get link to create a Microsoft account
/logout - Logout from your current email session
/topemails - Show top 5 users with the most emails generated
/status - Show bot status and statistics
/info - Show bot information and commands
/start - Send bot info embed to current channel
/block <user> - Block a user from using the bot (Owner only)
/unblock <user> - Unblock a user from using the bot (Owner only)

Setup

Prerequisites:
- Node.js v18 or higher
- Discord Bot Token
- Discord Application ID

Local Installation:
1. Clone the repository
2. Run npm install
3. Edit index.js and add your bot token and client ID
4. Run node index.js or use start.bat

Configuration (Edit these values in index.js):

const TOKEN = 'YOUR_BOT_TOKEN_HERE';
const CLIENT_ID = 'YOUR_CLIENT_ID_HERE';
const OWNER_ID = 'YOUR_USER_ID_HERE';
const PREMIUM_ROLE_ID = 'YOUR_PREMIUM_ROLE_ID_HERE';

Deploy to Render.com (Free Hosting):

1. Push your code to GitHub
2. Go to https://render.com and create an account
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - Name: temporary-email-bot
   - Region: Choose nearest to you
   - Branch: main
   - Runtime: Node
   - Build Command: npm install
   - Start Command: node index.js
6. Add Environment Variables:
   - TOKEN: Your Discord bot token
   - CLIENT_ID: Your Discord application ID
   - OWNER_ID: Your Discord user ID
   - PREMIUM_ROLE_ID: (optional) Your premium role ID
7. Click "Create Web Service"
8. Your bot will be deployed and start automatically

Alternative Free Hosting Options:
- Railway.app (https://railway.app)
- Fly.io (https://fly.io)
- Oracle Cloud Free Tier (https://www.oracle.com/cloud/free/)

Files Created

blocklist.json - Stores blocked users
history.json - Stores email generation history
stats.json - Stores total emails and commands
email_sessions.json - Stores active email login sessions

Requirements to Use

- Bot works in DMs and servers
- Users must enable DMs from server members (for DM commands)

Cooldown System

No cooldown restrictions for any users

License: MIT 
