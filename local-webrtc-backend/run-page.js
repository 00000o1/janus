#!/usr/bin/env node

const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { chromium } = require('playwright');
const readline = require('readline');

// Set up readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'chat> '
});

(async () => {
  if ( ! process.env.GH_ACCESS_TOKEN || ! process.env.REPO_URL ) {
    console.error(`You need to set GH_ACCESS_TOKEN and REPO_URL environment variables so this script can poll for and write comments at your repo.`);
    return process.exit(1);
  }

  const tempDir = await createTempDir();
  const browser = await chromium.launchPersistentContext(tempDir, { 
    headless: true,
    args: [
      `--disable-web-security`, // disable CORS to make requests to GH API to poll
      `--enable-local-file-access`, // enable file access to blog files
    ]
  });
  const page = await browser.newPage();

  page.on('console', message => {
    const text = message.text();
    if (text.startsWith('CHAT_MSG')) {
      // Extracts the username and message from the formatted string
      const chatMessage = text.match(/^CHAT_MSG \[(.*?)\]: (.*)$/);
      if (chatMessage && chatMessage.length >= 3) {
        console.log(`${chatMessage[1]} says: ${chatMessage[2]}`);
      }
    } else {
      console.log('PAGE LOG:', text);
    }
    rl.prompt();
  });
  page.on('pageerror', error => {
    console.warn(`PAGE ERROR: `, error);
  });

  const {
    GH_ACCESS_TOKEN, 
    REPO_URL
  } = process.env;
  const filePath = path.resolve(process.cwd(), 'local-webrtc-backend', 'page.html');
  const creds = JSON.stringify({GH_ACCESS_TOKEN, REPO_URL});
  const fileUrl = `file://${filePath}?ghCreds=${encodeURIComponent(creds)}`;
  await page.goto(fileUrl);

  rl.prompt();

  process.on('SIGINT', cleanupNow);

  // Listen to command line input
  rl.on('line', async (line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('reply ') || trimmedLine.startsWith('@')) {
      const [command, ...messageParts] = trimmedLine.split(' ');
      let ghUsername;
      if ( command.startsWith('@') ) {
        ghUsername = command.slice(1);
      } else {
        ghUsername = messageParts.shift();
      }
      const message = messageParts.join(' ');
      await page.evaluate(({ghUsername, message}) => globalThis.sendMessageToClient(ghUsername, message), {ghUsername, message});
    } else if (trimmedLine === 'list') {
      const handles = await page.evaluate(() => Object.keys(clients));
      console.log(`Connected clients: ${handles}`);
    } else if ( trimmedLine == 'quit' ) {
      await cleanupNow();
      return;
    } else if ( trimmedLine.startsWith('kick') ) {
      const [command, handle] = trimmedLine.split(' ');
      await page.evaluate(handle => clients?.[handle]?.destroy?.(), handle);
    } else if ( trimmedLine.startsWith('ban') ) {
      const [command, handle] = trimmedLine.split(' ');
      await page.evaluate(handle => banList.add(handle), handle);
      await page.evaluate(handle => clients?.[handle]?.destroy?.(), handle);
    } else if ( trimmedLine == 'help' ) {
      console.log(`Available commands: help, reply | @<username>, list, quit, kick, ban`);
    } else {
      console.log('Unknown command.');
    }
    rl.prompt();
  });

  return await new Promise(resolve => 0); // Keep the script running

  async function cleanupNow() {
    console.log('Closing browser due to Ctrl+C');
    setTimeout(() => rl.close(), 0);
    await browser.close();
    await cleanupTempUserDataDir(tempDir);
    process.exit(0);
  }
})();

async function cleanupTempUserDataDir(tempDir) {
  await fs.rm(tempDir, {
    recursive: true,
    force: true
  });
}

async function createTempDir() {
  const tmpBaseDir = os.tmpdir();
  const prefix = 'dosyago.janus_';  // Replace 'yourPrefix_' with your desired prefix

  try {
    const tmpDir = await fs.mkdtemp(path.join(tmpBaseDir, prefix));
    return tmpDir;
  } catch (err) {
    console.error('Failed to create temporary directory:', err);
    throw err;  // Re-throw the error if necessary
  }
}
