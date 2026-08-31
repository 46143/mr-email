const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID || '1518766351798370375';
const PREMIUM_ROLE_ID = process.env.PREMIUM_ROLE_ID;

// Validate required environment variables
if (!TOKEN) {
    console.error('[ERROR] TOKEN environment variable is required');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('[ERROR] CLIENT_ID environment variable is required');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages
    ]
});

let botStartTime = Date.now();
let blockedUsers = new Set();
let emailHistory = new Map();
let emailSessions = new Map();
let totalEmails = 0;
let totalCommands = 0;
let cachedDomains = [];
let lastDomainFetch = 0;

const BLOCKLIST_FILE = './blocklist.json';
const HISTORY_FILE = './history.json';
const STATS_FILE = './stats.json';
const EMAIL_SESSIONS_FILE = './email_sessions.json';

function loadData() {
    try {
        if (fs.existsSync(BLOCKLIST_FILE)) {
            const data = fs.readFileSync(BLOCKLIST_FILE, 'utf8');
            const parsed = JSON.parse(data);
            blockedUsers = new Set(parsed.blocked || []);
            console.log(`Loaded ${blockedUsers.size} blocked users`);
        }
    } catch (err) {
        console.error('Failed to load blocklist:', err.message);
    }

    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            emailHistory = new Map(Object.entries(parsed));
            console.log(`Loaded ${emailHistory.size} user histories`);
        }
    } catch (err) {
        console.error('Failed to load history:', err.message);
    }

    try {
        if (fs.existsSync(STATS_FILE)) {
            const data = fs.readFileSync(STATS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            totalEmails = parsed.totalEmails || 0;
            totalCommands = parsed.totalCommands || 0;
            console.log(`Loaded stats: ${totalEmails} emails, ${totalCommands} commands`);
        }
    } catch (err) {
        console.error('Failed to load stats:', err.message);
    }

    try {
        if (fs.existsSync(EMAIL_SESSIONS_FILE)) {
            const data = fs.readFileSync(EMAIL_SESSIONS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            emailSessions = new Map(Object.entries(parsed));
            console.log(`Loaded ${emailSessions.size} email sessions`);
        }
    } catch (err) {
        console.error('Failed to load email sessions:', err.message);
    }
}

function saveBlocklist() {
    try {
        const data = JSON.stringify({ blocked: Array.from(blockedUsers) }, null, 2);
        fs.writeFileSync(BLOCKLIST_FILE, data);
    } catch (err) {
        console.error('Failed to save blocklist:', err.message);
    }
}

function saveHistory() {
    try {
        const data = JSON.stringify(Object.fromEntries(emailHistory), null, 2);
        fs.writeFileSync(HISTORY_FILE, data);
    } catch (err) {
        console.error('Failed to save history:', err.message);
    }
}

function saveStats() {
    try {
        const data = JSON.stringify({ totalEmails, totalCommands }, null, 2);
        fs.writeFileSync(STATS_FILE, data);
    } catch (err) {
        console.error('Failed to save stats:', err.message);
    }
}

function saveEmailSessions() {
    try {
        const data = JSON.stringify(Object.fromEntries(emailSessions), null, 2);
        fs.writeFileSync(EMAIL_SESSIONS_FILE, data);
    } catch (err) {
        console.error('Failed to save email sessions:', err.message);
    }
}

async function getActiveDomains(forceRefresh = false) {
    const now = Date.now();
    
    if (!forceRefresh && cachedDomains.length > 0 && (now - lastDomainFetch) < 300000) {
        return cachedDomains;
    }
    
    try {
        const response = await axios.get('https://api.mail.tm/domains');
        if (response.data && response.data['hydra:member']) {
            const domains = response.data['hydra:member'].filter(d => d.isActive === true).map(d => d.domain);
            if (domains.length > 0) {
                cachedDomains = domains;
            }
        }
        lastDomainFetch = now;
        console.log(`Fetched ${cachedDomains.length} email domains`);
        return cachedDomains;
    } catch (error) {
        console.error('Failed to fetch domains:', error.message);
        return cachedDomains;
    }
}

async function updatePresence() {
    try {
        client.user.setPresence({
            status: 'dnd',
            activities: [{ name: `${totalEmails.toLocaleString()} emails generated`, type: 3 }]
        });
    } catch (error) {
        console.error('Failed to update presence:', error.message);
    }
}

async function isPremium(userId) {
    return userId === OWNER_ID;
}

function getCooldownTime(userId, isPremiumUser) {
    return 0;
}

function checkCooldown(userId, cooldownTime) {
    return { onCooldown: false, remaining: 0 };
}

async function updateCooldown(userId) {
    // No cooldown system
}

async function incrementUserEmailCount(userId) {
    try {
        const current = emailHistory.get(userId) || 0;
        emailHistory.set(userId, current + 1);
        saveHistory();
    } catch (error) {
        console.error('Failed to increment email count:', error.message);
    }
}

async function createTempEmail(domain) {
    const randomName = Math.random().toString(36).substring(2, 15) + Math.floor(Math.random() * 10000);
    const email = `${randomName}@${domain}`;
    const password = Math.random().toString(36).substring(2, 20) + Math.random().toString(36).substring(2, 10);
    
    try {
        const response = await axios.post('https://api.mail.tm/accounts', {
            address: email,
            password: password
        }, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        
        if (response.status === 201) {
            const tokenResponse = await axios.post('https://api.mail.tm/token', {
                address: email,
                password: password
            });
            
            return { email, password, token: tokenResponse.data.token };
        }
        throw new Error('Failed to create email');
    } catch (error) {
        console.error('Create email error:', error.response?.status, error.response?.data);
        throw new Error('Failed to create email account');
    }
}

async function fetchEmailInbox(token) {
    try {
        console.log('[DEBUG] Fetching inbox with token...');
        const response = await axios.get('https://api.mail.tm/messages', {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('[DEBUG] Inbox response status:', response.status);
        console.log('[DEBUG] Inbox message count:', response.data['hydra:totalItems'] || 0);
        return response.data['hydra:member'] || [];
    } catch (error) {
        console.error('[ERROR] Fetch inbox error:', error.message);
        if (error.response) {
            console.error('[ERROR] Response status:', error.response.status);
            console.error('[ERROR] Response data:', error.response.data);
        }
        throw new Error('Failed to fetch inbox');
    }
}

async function fetchEmailContent(token, messageId) {
    try {
        console.log('[DEBUG] Fetching email content for message ID:', messageId);
        const response = await axios.get(`https://api.mail.tm/messages/${messageId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('[DEBUG] Email content fetched successfully');
        console.log('[DEBUG] Available fields in email content:', Object.keys(response.data));
        return response.data;
    } catch (error) {
        console.error('[ERROR] Fetch email content error:', error.message);
        if (error.response) {
            console.error('[ERROR] Response status:', error.response.status);
            console.error('[ERROR] Response data:', error.response.data);
        }
        throw new Error('Failed to fetch email content');
    }
}

function extractSecurityCode(text) {
    // Look for security codes in common patterns
    const patterns = [
        /Sicherheitscode[:\s]+(\d{4,8})/i,
        /security code[:\s]+(\d{4,8})/i,
        /verification code[:\s]+(\d{4,8})/i,
        /code[:\s]+(\d{4,8})/i,
        /einmalcode[:\s]+(\d{4,8})/i,
        /otp[:\s]+(\d{4,8})/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1];
        }
    }
    
    // Also look for standalone 6-digit numbers
    const standaloneCode = text.match(/\b(\d{6})\b/);
    if (standaloneCode) {
        return standaloneCode[1];
    }
    
    return null;
}

const commands = [
    new SlashCommandBuilder().setName('egen').setDescription('Generate a temporary email address').addStringOption(opt => opt.setName('domain').setDescription('Domain number (1-10) or full domain name').setRequired(true)),
    new SlashCommandBuilder().setName('domains').setDescription('Show currently active email domains'),
    new SlashCommandBuilder().setName('login').setDescription('Login to an existing temporary email').addStringOption(opt => opt.setName('email').setDescription('Email address').setRequired(true)).addStringOption(opt => opt.setName('token').setDescription('Token from creation').setRequired(true)),
    new SlashCommandBuilder().setName('inbox').setDescription('View messages in your logged-in email inbox'),
    new SlashCommandBuilder().setName('read').setDescription('Read a specific email message').addStringOption(opt => opt.setName('id').setDescription('Message ID from inbox').setRequired(true)),
    new SlashCommandBuilder().setName('latest').setDescription('Read the most recent email message'),
    new SlashCommandBuilder().setName('microsoft').setDescription('Get link to create a Microsoft account'),
    new SlashCommandBuilder().setName('logout').setDescription('Logout from your current email session'),
    new SlashCommandBuilder().setName('topemails').setDescription('Show top 5 users with the most emails generated'),
    new SlashCommandBuilder().setName('status').setDescription('Show bot status and statistics'),
    new SlashCommandBuilder().setName('info').setDescription('Show bot information and commands'),
    new SlashCommandBuilder().setName('start').setDescription('Send bot info embed to current channel'),
    new SlashCommandBuilder().setName('block').setDescription('Block a user from using the bot').addUserOption(opt => opt.setName('user').setDescription('User to block').setRequired(true)),
    new SlashCommandBuilder().setName('unblock').setDescription('Unblock a user from using the bot').addUserOption(opt => opt.setName('user').setDescription('User to unblock').setRequired(true))
];

client.on('ready', async () => {
    try {
        loadData();
        console.log(`Logged in as ${client.user.tag}`);
        
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        
        try {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('Slash commands registered globally');
        } catch (error) {
            console.error('Failed to register slash commands:', error);
        }
        
        try {
            const domains = await getActiveDomains(true);
            console.log(`Fetched ${domains.length} email domains`);
        } catch (error) {
            console.error('Failed to fetch domains:', error);
        }
        
        console.log(`Bot is ready! Serving ${client.guilds.cache.size} servers`);
        client.user.setActivity(`${totalEmails} emails generated`, { type: 'WATCHING' });
    } catch (error) {
        console.error('Ready event error:', error);
    }
});

client.on('disconnect', () => {
    console.log('[WARN] Bot disconnected from Discord');
});

client.on('reconnecting', () => {
    console.log('[INFO] Bot reconnecting to Discord...');
});

client.on('error', (error) => {
    console.error('[ERROR] Discord client error:', error);
});

client.on('warn', (warning) => {
    console.warn('[WARN] Discord client warning:', warning);
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('[ERROR] Uncaught Exception:', error);
    // Don't exit, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit, just log the error
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    
    const { commandName, user, options } = interaction;
    
    try {
        console.log('[DEBUG] Command executed:', commandName, 'by user:', user.tag);
        totalCommands++;
        saveStats();
        
        if (blockedUsers.has(user.id) && user.id !== OWNER_ID) {
            const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Access Denied').setDescription('You have been blocked from using this bot.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        
        if (commandName === 'domains') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const domains = await getActiveDomains(true);
                if (domains.length === 0) {
                    const embed = new EmbedBuilder().setColor(0xED4245).setTitle('No Domains Available').setDescription('No active domains found. Please try again later.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                    return interaction.editReply({ embeds: [embed] });
                }
                const topDomains = domains.slice(0, 10);
                let domainList = '';
                for (let i = 0; i < topDomains.length; i++) domainList += `**${i + 1}.** \`${topDomains[i]}\`\n`;
                const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Available Email Domains').setDescription(`Here are the currently active domains:\n\n${domainList}`).addFields({ name: 'Usage', value: `Use \`/egen 1\` or \`/egen ${topDomains[0]}\` to create an email`, inline: false }).setFooter({ text: 'Domains refresh every 5 minutes • Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to fetch domains. Please try again later.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        }
        
        else if (commandName === 'egen') {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const domainInput = options.getString('domain');
                const activeDomains = await getActiveDomains();
                if (activeDomains.length === 0) throw new Error('No active domains available');
                
                let selectedDomain = null;
                const domainNumber = parseInt(domainInput);
                if (!isNaN(domainNumber) && domainNumber >= 1 && domainNumber <= activeDomains.length) {
                    selectedDomain = activeDomains[domainNumber - 1];
                } else if (activeDomains.includes(domainInput)) {
                    selectedDomain = domainInput;
                } else {
                    const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Invalid Domain').setDescription(`"${domainInput}" is not a valid domain.`).addFields({ name: 'Available Domains', value: `Use \`/domains\` to see valid options`, inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                    return interaction.editReply({ embeds: [embed] });
                }
                
                const emailData = await createTempEmail(selectedDomain);
                await updateCooldown(user.id);
                await incrementUserEmailCount(user.id);
                totalEmails++;
                saveStats();
                await updatePresence();
                
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle('Temporary Email Created').setDescription('Your temporary email is ready to use. Save these credentials!').addFields({ name: 'Email Address', value: `\`${emailData.email}\``, inline: false }, { name: 'Token', value: `||${emailData.token}||`, inline: false }, { name: 'Note', value: 'Use `/login email token` to access your inbox later', inline: false }).setFooter({ text: 'Mail.tm • LuckyTools', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                
                await interaction.user.send({ embeds: [embed] }).catch(() => { throw new Error('Cannot send DMs. Please enable DMs from server members.'); });
                const successEmbed = new EmbedBuilder().setColor(0x57F287).setTitle('Email Sent!').setDescription('Check your DMs for your new temporary email credentials.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
            } catch (error) {
                const errorEmbed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription(error.message || 'Failed to create temporary email. Please try again later.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [errorEmbed] });
            }
        }
        
        else if (commandName === 'login') {
            await interaction.deferReply({ ephemeral: true });
            
            const currentSession = emailSessions.get(user.id);
            if (currentSession) {
                const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('Already Logged In').setDescription(`You are currently logged into **${currentSession.email}**`).addFields({ name: 'Tip', value: 'Use `/logout` first before logging into a different account', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            
            const email = options.getString('email');
            const token = options.getString('token');
            
            try {
                emailSessions.set(user.id, { email, token, createdAt: Date.now() });
                saveEmailSessions();
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle('Login Successful').setDescription(`Successfully logged in as **${email}**`).addFields({ name: 'Next Step', value: 'Use `/inbox` to view your messages', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Login Failed').setDescription('An error occurred while trying to login. Please try again later.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        }
        
        else if (commandName === 'inbox') {
            await interaction.deferReply({ ephemeral: true });
            const session = emailSessions.get(user.id);
            if (!session) {
                const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('No Active Session').setDescription('You are not logged into any email account.').addFields({ name: 'Tip', value: 'Use `/login email token` to access your inbox', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            try {
                const messages = await fetchEmailInbox(session.token);
                if (!messages || messages.length === 0) {
                    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Inbox Empty').setDescription(`Your inbox for **${session.email}** is empty.`).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                    return interaction.editReply({ embeds: [embed] });
                }
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle(`Inbox (${messages.length} Messages)`).setDescription(`Logged in as: **${session.email}**\n\nUse \`/read <id>\` to read the full email`).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                for (let i = 0; i < Math.min(messages.length, 10); i++) {
                    const msg = messages[i];
                    const subject = msg.subject || '(No Subject)';
                    const from = msg.from?.address || 'Unknown';
                    embed.addFields({ name: `📧 ${subject.length > 50 ? subject.substring(0, 47) + '...' : subject}`, value: `**From:** ${from}\n**ID:** \`${msg.id}\`\n**Date:** ${new Date(msg.createdAt).toLocaleString()}`, inline: false });
                }
                if (messages.length > 10) embed.setFooter({ text: `Showing 10 of ${messages.length} messages • Use /read <id> for full emails` });
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Inbox Error').setDescription('Failed to fetch inbox. Your token may have expired.').addFields({ name: 'Tip', value: 'Try logging in again with `/login`', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        }
        
        else if (commandName === 'read') {
            await interaction.deferReply({ ephemeral: true });
            const session = emailSessions.get(user.id);
            if (!session) {
                const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('No Active Session').setDescription('You are not logged into any email account.').addFields({ name: 'Tip', value: 'Use `/login email token` to access your inbox', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            
            const messageId = options.getString('id');
            
            try {
                const emailContent = await fetchEmailContent(session.token, messageId);
                const subject = emailContent.subject || '(No Subject)';
                const from = emailContent.from?.address || 'Unknown';
                const to = emailContent.to?.[0]?.address || 'Unknown';
                const date = new Date(emailContent.createdAt).toLocaleString();
                
                // Try different ways to get the body content
                let body = '(No content)';
                if (typeof emailContent.text === 'string' && emailContent.text.length > 10) {
                    body = emailContent.text;
                } else if (emailContent.html && emailContent.html.length > 0 && emailContent.html[0].length > 10) {
                    body = emailContent.html[0];
                } else if (emailContent.text && emailContent.text.length > 0 && emailContent.text[0].length > 10) {
                    body = emailContent.text[0];
                } else if (emailContent.intro && emailContent.intro.length > 10) {
                    body = emailContent.intro;
                } else if (typeof emailContent.html === 'string' && emailContent.html.length > 10) {
                    body = emailContent.html;
                }
                
                const maxLength = 4000;
                const bodyParts = [];
                for (let i = 0; i < body.length; i += maxLength) {
                    bodyParts.push(body.substring(i, i + maxLength));
                }
                
                // Extract security code
                const securityCode = extractSecurityCode(body);
                
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle(`📧 ${subject}`)
                    .addFields(
                        { name: 'From', value: from, inline: true },
                        { name: 'To', value: to, inline: true },
                        { name: 'Date', value: date, inline: true }
                    )
                    .setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();
                
                if (securityCode) {
                    embed.addFields({ name: '🔐 Security Code', value: `**${securityCode}**`, inline: false });
                }
                
                await interaction.editReply({ embeds: [embed] });
                
                // Only send body if no security code was found
                if (!securityCode) {
                    for (const part of bodyParts) {
                        // Remove HTML tags and send plain text
                        const plainText = part.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim();
                        // Split into chunks of 2000 characters
                        for (let i = 0; i < plainText.length; i += 2000) {
                            const chunk = plainText.substring(i, i + 2000);
                            await interaction.followUp({ content: chunk, ephemeral: true });
                        }
                    }
                }
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Read Error').setDescription('Failed to fetch email content. The message ID may be invalid or your token may have expired.').addFields({ name: 'Tip', value: 'Use `/inbox` to get valid message IDs', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        }
        
        else if (commandName === 'latest') {
            await interaction.deferReply({ ephemeral: true });
            const session = emailSessions.get(user.id);
            if (!session) {
                const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('No Active Session').setDescription('You are not logged into any email account.').addFields({ name: 'Tip', value: 'Use `/login email token` to access your inbox', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            
            try {
                const messages = await fetchEmailInbox(session.token);
                if (!messages || messages.length === 0) {
                    const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('No Emails').setDescription('Your inbox is empty.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                    return interaction.editReply({ embeds: [embed] });
                }
                
                const latestMessage = messages[0];
                console.log('Latest message:', JSON.stringify(latestMessage, null, 2));
                const emailContent = await fetchEmailContent(session.token, latestMessage.id);
                console.log('Email content:', JSON.stringify(emailContent, null, 2));
                const subject = emailContent.subject || '(No Subject)';
                const from = emailContent.from?.address || 'Unknown';
                const to = emailContent.to?.[0]?.address || 'Unknown';
                const date = new Date(emailContent.createdAt).toLocaleString();
                
                // Try different ways to get the body content
                let body = '(No content)';
                console.log('Available fields:', Object.keys(emailContent));
                if (typeof emailContent.text === 'string' && emailContent.text.length > 10) {
                    body = emailContent.text;
                    console.log('Using text as string, length:', body.length);
                } else if (emailContent.html && emailContent.html.length > 0 && emailContent.html[0].length > 10) {
                    body = emailContent.html[0];
                    console.log('Using html[0], length:', body.length);
                } else if (emailContent.text && emailContent.text.length > 0 && emailContent.text[0].length > 10) {
                    body = emailContent.text[0];
                    console.log('Using text[0], length:', body.length);
                } else if (emailContent.intro && emailContent.intro.length > 10) {
                    body = emailContent.intro;
                    console.log('Using intro, length:', body.length);
                } else if (typeof emailContent.html === 'string' && emailContent.html.length > 10) {
                    body = emailContent.html;
                    console.log('Using html as string, length:', body.length);
                }
                console.log('Final body length:', body.length);
                
                const maxLength = 4000;
                const bodyParts = [];
                for (let i = 0; i < body.length; i += maxLength) {
                    bodyParts.push(body.substring(i, i + maxLength));
                }
                console.log('Body parts count:', bodyParts.length);
                
                // Extract security code
                const securityCode = extractSecurityCode(body);
                
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle(`📧 ${subject}`)
                    .addFields(
                        { name: 'From', value: from, inline: true },
                        { name: 'To', value: to, inline: true },
                        { name: 'Date', value: date, inline: true }
                    )
                    .setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();
                
                if (securityCode) {
                    embed.addFields({ name: '🔐 Security Code', value: `**${securityCode}**`, inline: false });
                }
                
                console.log('Sending embed...');
                await interaction.editReply({ embeds: [embed] });
                console.log('Embed sent successfully');
                
                // Only send body if no security code was found
                if (!securityCode) {
                    console.log('Sending body parts...');
                    for (const part of bodyParts) {
                        console.log('Sending part, length:', part.length);
                        // Remove HTML tags and send plain text
                        const plainText = part.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim();
                        // Split into chunks of 2000 characters
                        for (let i = 0; i < plainText.length; i += 2000) {
                            const chunk = plainText.substring(i, i + 2000);
                            await interaction.followUp({ content: chunk, ephemeral: true });
                        }
                    }
                    console.log('All parts sent successfully');
                }
            } catch (error) {
                console.error('Error in /latest:', error);
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to fetch latest email. Your token may have expired.').addFields({ name: 'Tip', value: 'Try logging in again with `/login`', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        }
        
        else if (commandName === 'microsoft') {
            const embed = new EmbedBuilder()
                .setColor(0x00A4EF)
                .setTitle('Microsoft Konto erstellen')
                .setDescription('Klicke auf den Link unten, um ein neues Microsoft-Konto zu erstellen:')
                .addFields({ name: 'Link', value: 'https://signup.live.com/', inline: false })
                .addFields({ name: 'Tipp', value: 'Verwende eine temporäre E-Mail von diesem Bot für die Bestätigung.', inline: false })
                .setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        
        else if (commandName === 'logout') {
            await interaction.deferReply({ ephemeral: true });
            const session = emailSessions.get(user.id);
            if (!session) {
                const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('Not Logged In').setDescription('You are not logged into any email account.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            const email = session.email;
            emailSessions.delete(user.id);
            saveEmailSessions();
            const embed = new EmbedBuilder().setColor(0x57F287).setTitle('Logged Out').setDescription(`Successfully logged out from **${email}**`).addFields({ name: 'Note', value: 'Your email still exists. Use `/login` to log back in', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }
        
        else if (commandName === 'topemails') {
            try {
                if (emailHistory.size === 0) {
                    const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('Top Email Generators').setDescription('No emails have been generated yet. Be the first!').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                const sorted = Array.from(emailHistory.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
                let description = '';
                const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
                for (let i = 0; i < sorted.length; i++) {
                    const [userId, count] = sorted[i];
                    let username = 'Unknown User';
                    try {
                        const userData = await client.users.fetch(userId);
                        username = userData.tag;
                    } catch (err) {}
                    description += `${medals[i]} **${username}** ─ \`${count}\` email${count !== 1 ? 's' : ''}\n`;
                }
                const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('TOP EMAIL GENERATORS').setDescription(description).addFields({ name: 'Total Emails Generated', value: `\`${totalEmails.toLocaleString()}\``, inline: true }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to fetch leaderboard. Please try again later.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        
        else if (commandName === 'status') {
            try {
                const uptimeSeconds = Math.floor((Date.now() - botStartTime) / 1000);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle('Bot Status').addFields({ name: 'Status', value: 'Online', inline: true }, { name: 'Latency', value: `${Math.round(client.ws.ping)}ms`, inline: true }, { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true }, { name: 'Total Emails', value: `${totalEmails.toLocaleString()}`, inline: true }, { name: 'Total Commands', value: `${totalCommands.toLocaleString()}`, inline: true }, { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to fetch bot status.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        
        else if (commandName === 'info') {
            try {
                const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Temporary Email Bot').setDescription('Generate temporary email addresses directly in Discord DMs.').addFields({ name: 'Commands', value: '`/egen` - Generate email\n`/login` - Login to email\n`/inbox` - View messages\n`/logout` - Logout\n`/domains` - Available domains\n`/topemails` - Leaderboard\n`/status` - Bot status\n`/info` - Bot info', inline: false }, { name: 'Service', value: 'Powered by Mail.tm', inline: true }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to fetch bot info.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        
        else if (commandName === 'start') {
            if (user.id !== OWNER_ID) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Owner Only').setDescription('Only the bot owner can use this command.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            try {
                const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('TEMPORARY EMAIL BOT').setDescription('Generate temporary email addresses right inside Discord DMs.').addFields({ name: 'GET STARTED', value: '1. DM the bot\n2. Type `/domains` to see available domains\n3. Type `/egen 1` to create an email\n4. Save your email and token\n5. Use `/inbox` to check messages', inline: false }, { name: 'COMMANDS', value: '`/domains` - Show active domains\n`/egen` - Generate email\n`/login` - Login to email\n`/inbox` - View messages\n`/logout` - Logout\n`/topemails` - Leaderboard\n`/status` - Bot stats\n`/info` - Bot info', inline: false }).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed] });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to send start message.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        
        else if (commandName === 'block') {
            if (user.id !== OWNER_ID) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Owner Only').setDescription('Only the bot owner can use this command.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            try {
                const targetUser = options.getUser('user');
                blockedUsers.add(targetUser.id);
                saveBlocklist();
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle('User Blocked').setDescription(`${targetUser.tag} has been blocked from using the bot.`).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to block user.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        
        else if (commandName === 'unblock') {
            if (user.id !== OWNER_ID) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Owner Only').setDescription('Only the bot owner can use this command.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            try {
                const targetUser = options.getUser('user');
                blockedUsers.delete(targetUser.id);
                saveBlocklist();
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle('User Unblocked').setDescription(`${targetUser.tag} has been unblocked and can use the bot again.`).setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Error').setDescription('Failed to unblock user.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        
    } catch (error) {
        console.error('Interaction error:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Unexpected Error').setDescription('An unexpected error occurred. Please try again later.').setFooter({ text: 'Temporary Email Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.editReply({ content: 'An unexpected error occurred. Please try again later.' });
            }
        } catch (err) {
            console.error('Failed to send error message:', err);
        }
    }
});

// Health check server for cloud hosting
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        bot: 'Temporary Email Bot',
        uptime: Math.floor((Date.now() - botStartTime) / 1000),
        servers: client.guilds.cache.size,
        totalEmails: totalEmails
    });
});

app.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
});

client.login(TOKEN);
