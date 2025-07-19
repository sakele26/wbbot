const { Client, GatewayIntentBits, Partials, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const wenbucksFile = path.join(__dirname, 'wenbucks.json');
const botCommandsChannelId = '1395934262942892102'; // Change if needed

// Load or initialize Wenbucks data
let wenbucks = {};
if (fs.existsSync(wenbucksFile)) {
  try {
    wenbucks = JSON.parse(fs.readFileSync(wenbucksFile));
  } catch {
    wenbucks = {};
  }
} else {
  fs.writeFileSync(wenbucksFile, JSON.stringify(wenbucks, null, 2));
}

function saveWenbucks() {
  fs.writeFileSync(wenbucksFile, JSON.stringify(wenbucks, null, 2));
}

// Cooldown map: userId => timestamp of last game
const blackjackCooldown = new Map();
const COOLDOWN_SECONDS = 10 * 1000;

// Helper to get or create user data
function getUserData(userId) {
  if (!wenbucks[userId]) {
    // No starting balance now — users must earn by chatting
    wenbucks[userId] = { messages: 0, balance: 0 };
  }
  return wenbucks[userId];
}

// Simple card utilities for Blackjack
const cardValues = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 10, Q: 10, K: 10, A: 11,
};
const cards = Object.keys(cardValues);

function drawCard() {
  const rank = cards[Math.floor(Math.random() * cards.length)];
  return rank;
}

// Calculate Blackjack hand value, counting Aces as 1 or 11
function calculateHandValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValues[card];
    if (card === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10; // count Ace as 1 instead of 11
    aces--;
  }
  return total;
}

// Format hand as string
function formatHand(hand) {
  return hand.join(', ');
}

// Track active Blackjack games: userId => game state
const activeBlackjackGames = new Map();

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online.`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;

  // Wenbucks earning system (every 5 messages = $5)
  const userData = getUserData(userId);
  userData.messages = (userData.messages || 0) + 1;
  if (userData.messages >= 5) {
    userData.messages = 0;
    userData.balance += 5;
    const channel = client.channels.cache.get(botCommandsChannelId);
    if (channel) {
      channel.send(`<@${userId}> earned $5 Wenbucks for chatting! 💸 (Balance: $${userData.balance})`);
    }
    saveWenbucks();
  }

  // If user is currently in Blackjack betting mode
  if (activeBlackjackGames.has(userId)) {
    const game = activeBlackjackGames.get(userId);

    // Expecting bet input
    if (!game.bet) {
      // Try to parse bet amount from message
      const bet = parseInt(message.content);
      if (isNaN(bet) || bet <= 0) {
        message.reply("Please enter a valid positive number for your bet.");
        return;
      }
      if (bet > userData.balance) {
        message.reply(`You don't have enough Wenbucks. Your balance is $${userData.balance}. Enter a smaller bet.`);
        return;
      }

      // Deduct bet and store it
      userData.balance -= bet;
      game.bet = bet;

      await message.reply(`You bet $${bet}. Dealing cards...`);

      // Deal initial hands
      game.playerHand = [drawCard(), drawCard()];
      game.dealerHand = [drawCard(), drawCard()];

      const playerValue = calculateHandValue(game.playerHand);
      const dealerValue = calculateHandValue(game.dealerHand);

      // Show player hand and one dealer card (the other face down)
      await message.channel.send(`Your hand: ${formatHand(game.playerHand)} (Total: ${playerValue})\nDealer's visible card: ${game.dealerHand[0]}`);

      // Check for immediate blackjack scenarios
      if (playerValue === 21 && dealerValue === 21) {
        // Push
        userData.balance += bet; // refund bet
        saveWenbucks();
        activeBlackjackGames.delete(userId);
        return message.channel.send(`Both you and the dealer have Blackjack! It's a push. Your bet of $${bet} is returned. Balance: $${userData.balance}`);
      }
      if (playerValue === 21) {
        // Player blackjack wins 3:2 payout
        const payout = Math.floor(bet * 1.5) + bet; // bet + 1.5*bet
        userData.balance += payout;
        saveWenbucks();
        activeBlackjackGames.delete(userId);
        return message.channel.send(`Blackjack! You win $${payout} (3:2 payout). New balance: $${userData.balance}`);
      }
      if (dealerValue === 21) {
        // Dealer blackjack wins
        saveWenbucks();
        activeBlackjackGames.delete(userId);
        return message.channel.send(`Dealer has Blackjack! You lose your bet of $${bet}. Balance: $${userData.balance}`);
      }

      // If no blackjack, prompt player to hit or stand
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
        );

      game.playerValue = playerValue;
      game.dealerValue = dealerValue;

      await message.channel.send({ content: 'Do you want to **Hit** or **Stand**?', components: [row] });
      return;
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  // $casino command buttons
  if (interaction.customId === 'blackjack') {
    // Cooldown check
    const now = Date.now();
    if (blackjackCooldown.has(userId) && now - blackjackCooldown.get(userId) < COOLDOWN_SECONDS) {
      return interaction.reply({ content: `Please wait before playing Blackjack again.`, ephemeral: true });
    }
    blackjackCooldown.set(userId, now);

    // Start new game waiting for bet input
    if (!activeBlackjackGames.has(userId)) {
      activeBlackjackGames.set(userId, {});
      await interaction.reply({ content: `You chose Blackjack! Please type your bet amount in Wenbucks in chat.`, ephemeral: true });
    } else {
      await interaction.reply({ content: `You already have an active Blackjack game! Please finish it before starting a new one.`, ephemeral: true });
    }
    return;
  }

  // Blackjack gameplay buttons (hit or stand)
  if (interaction.customId === 'hit' || interaction.customId === 'stand') {
    if (!activeBlackjackGames.has(userId)) {
      return interaction.reply({ content: `You have no active Blackjack game. Use /casino to start one.`, ephemeral: true });
    }
    const game = activeBlackjackGames.get(userId);
    const userData = getUserData(userId);

    if (!game.bet) {
      return interaction.reply({ content: `Please enter your bet amount first in chat before playing.`, ephemeral: true });
    }

    if (interaction.customId === 'hit') {
      // Player takes a card
      const card = drawCard();
      game.playerHand.push(card);
      game.playerValue = calculateHandValue(game.playerHand);

      let msg = `You drew a ${card}. Your hand: ${formatHand(game.playerHand)} (Total: ${game.playerValue})`;

      if (game.playerValue > 21) {
        // Player busts - lose bet
        activeBlackjackGames.delete(userId);
        saveWenbucks();
        return interaction.update({ content: `${msg}\nBust! You lose your bet of $${game.bet}. Balance: $${userData.balance}`, components: [] });
      } else {
        // Continue playing
        return interaction.update({ content: `${msg}\nDo you want to **Hit** or **Stand**?`, components: interaction.message.components });
      }
    }

    if (interaction.customId === 'stand') {
      // Dealer's turn: dealer hits until 17 or more
      while (game.dealerValue < 17) {
        const card = drawCard();
        game.dealerHand.push(card);
        game.dealerValue = calculateHandValue(game.dealerHand);
      }

      // Determine winner
      let resultMsg = `Dealer's hand: ${formatHand(game.dealerHand)} (Total: ${game.dealerValue})\nYour hand: ${formatHand(game.playerHand)} (Total: ${game.playerValue})\n`;

      if (game.dealerValue > 21 || game.playerValue > game.dealerValue) {
        // Player wins, pays 1:1 on bet
        const payout = game.bet * 2; // bet returned + winnings equal to bet
        userData.balance += payout;
        resultMsg += `You win! You receive $${payout}. New balance: $${userData.balance}`;
      } else if (game.playerValue === game.dealerValue) {
        // Push - return bet
        userData.balance += game.bet;
        resultMsg += `Push! Your bet of $${game.bet} is returned. Balance: $${userData.balance}`;
      } else {
        // Dealer wins - player loses bet (already deducted)
        resultMsg += `Dealer wins! You lose your bet of $${game.bet}. Balance: $${userData.balance}`;
      }

      activeBlackjackGames.delete(userId);
      saveWenbucks();
      return interaction.update({ content: resultMsg, components: [] });
    }
  }

  // You can add Ride the Bus buttons handling here later
});

// Basic command to launch casino games with buttons
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '$casino') {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('blackjack').setLabel('Blackjack').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ridebus').setLabel('Ride the Bus').setStyle(ButtonStyle.Secondary),
      );

    await message.channel.send({
      content: `Welcome to the Makwenna Casino! What game would you like to play today?`,
      components: [row],
    });
  }
});

client.login(process.env.TOKEN);
