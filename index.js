const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const wenbucksFile = path.join(__dirname, 'wenbucks.json');
const botCommandsChannelId = '1395934262942892102';

// Load or initialize Wenbucks data
let wenbucks = {};
if (fs.existsSync(wenbucksFile)) {
  wenbucks = JSON.parse(fs.readFileSync(wenbucksFile));
} else {
  fs.writeFileSync(wenbucksFile, JSON.stringify(wenbucks, null, 2));
}

// Helper: Save Wenbucks to file
function saveWenbucks() {
  fs.writeFileSync(wenbucksFile, JSON.stringify(wenbucks, null, 2));
}

// Main: Earn Wenbucks on messages
client.on('messageCreate', (message) => {
  if (message.author.bot) return; // Ignore bots

  const userId = message.author.id;

  // Earn $5 Wenbucks per 5 messages
  if (!wenbucks[userId]) {
    wenbucks[userId] = { messages: 0, balance: 0 };
  }

  wenbucks[userId].messages += 1;

  if (wenbucks[userId].messages >= 5) {
    wenbucks[userId].messages = 0;
    wenbucks[userId].balance += 5;

    // Only post earn notification in bot-commands channel
    const earnMsg = `<@${userId}> earned $5 Wenbucks for chatting! 💸 (New balance: $${wenbucks[userId].balance})`;
    const channel = client.channels.cache.get(botCommandsChannelId);
    if (channel) {
      channel.send(earnMsg);
    }
  }

  saveWenbucks();
});

// Start bot
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online.`);
});

client.login(process.env.TOKEN);
