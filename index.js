const mineflayer = require('mineflayer');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

let bot = null;
let hasLoggedReconnect = false;
let attackInterval = null;
let lookInterval = null;
let minecartInterval = null;
let nightInterval = null;
let autoEatInterval = null;
let isEating = false;
let nightMessageSent = false;
let attackCount = 0;
const onlinePlayers = new Set();

let reconnectCount = 0;
let backupBot = null;
let pauseMainBotReconnect = false;

// ---- HTTP 保活 ----
app.get('/', (req, res) => {
  res.send('你妈妈来喽！');
});
app.listen(PORT, () => {
  console.log(`[系统] HTTP 服务启动 端口 ${PORT}`);
});

// ---- 启动主机器人 ----
function createBot() {
  bot = mineflayer.createBot({
    host: '87world.aternos.me',
    port: 15945,
    username: 'sohai_tim'
  });

  bot.on('spawn', () => {
    console.log('［系统］sohai_tim 加入了游戏');
    startLookLoop();
    startMinecartLoop();
    startAutoEatLoop();
    startAttackLoop();
    startNightCheckLoop();
  });

  bot.on('error', (err) => {
    console.log('［错误］类型:', err.name);
    console.log('［错误］原因:', err.message);
  });

  bot.on('end', () => {
    console.log('［系统］sohai_tim 离开了游戏');
    hasLoggedReconnect = false;
    if (attackInterval) clearInterval(attackInterval);
    if (lookInterval) clearInterval(lookInterval);
    if (minecartInterval) clearInterval(minecartInterval);
    if (nightInterval) clearInterval(nightInterval);

    reconnectCount++;

    if (reconnectCount >= 3 && !backupBot) {
      createBackupBot();
    }

    if (!pauseMainBotReconnect) {
      setTimeout(() => {
        if (!hasLoggedReconnect) {
          console.log('［系统］断线重连回复中...');
          hasLoggedReconnect = true;
        }
        createBot();
      }, 10000);
    }
  });

  bot.on('chat', (username, message) => {
    console.log(`［系统］<${username}> ${message}`);
    if (message.toLowerCase() === 'zzz') {
      setTimeout(() => bot.chat("我先溜了 马上回来！"), 1000);
      setTimeout(() => bot.end(), 2000);
    }
  });

  bot.on('message', (msg) => {
    const text = msg.toString();
    if (text.includes("joined the game")) {
      const playerName = text.split(" ")[0];
      if (playerName === bot.username) return;
      if (!onlinePlayers.has(playerName)) {
        onlinePlayers.add(playerName);
        console.log(`［系统］${playerName} 加入了游戏`);
        const time = bot.time.timeOfDay;
        const isNight = time >= 12542 && time <= 23000;
        if (isNight && nightMessageSent) {
          bot.chat(`${playerName}上线！ 当前为晚上，要睡觉喊我一声zzz！`);
        }
      }
    }
    if (text.includes("left the game")) {
      const playerName = text.split(" ")[0];
      if (playerName === bot.username) return;
      if (onlinePlayers.has(playerName)) {
        onlinePlayers.delete(playerName);
        console.log(`［系统］${playerName} 离开了游戏`);
      }
    }
  });

  // ---- 平滑看向生物 ----
  function startLookLoop(turnSpeed = 3) {
    if (lookInterval) clearInterval(lookInterval);
    lookInterval = setInterval(() => {
      if (!bot || !bot.entity) return;
      const nearbyEntities = Object.values(bot.entities).filter(e =>
        e !== bot.entity &&
        (e.type === 'player' || e.type === 'mob') &&
        bot.entity.position.distanceTo(e.position) <= 5 &&
        !(e.type === 'mob' && e.name === 'minecart' && e.passengers?.length > 0)
      );
      if (!nearbyEntities.length) return;
      const target = nearbyEntities.sort((a, b) =>
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
      )[0];
      const targetPos = target.position.offset(0, (target.height || 1) * 0.8, 0);
      const dx = targetPos.x - bot.entity.position.x;
      const dy = targetPos.y - (bot.entity.position.y + (bot.entity.height || 1));
      const dz = targetPos.z - bot.entity.position.z;
      const targetYaw = Math.atan2(-dx, -dz);
      const targetPitch = Math.atan2(dy, Math.sqrt(dx*dx + dz*dz));
      let deltaYaw = ((targetYaw - bot.entity.yaw + Math.PI) % (2 * Math.PI)) - Math.PI;
      bot.entity.yaw += Math.sign(deltaYaw) * Math.min(turnSpeed, Math.abs(deltaYaw));
      let deltaPitch = targetPitch - bot.entity.pitch;
      bot.entity.pitch += Math.sign(deltaPitch) * Math.min(turnSpeed, Math.abs(deltaPitch));
    }, 200);
  }

  // ---- 自动坐矿车 ----
  function startMinecartLoop() {
    if (minecartInterval) clearInterval(minecartInterval);
    minecartInterval = setInterval(async () => {
      if (!bot || !bot.entity) return;
      const nearest = Object.values(bot.entities).find(e =>
        e.type === 'mob' &&
        (e.name === 'minecart' || e.name === 'minecraft:minecart') &&
        bot.entity.position.distanceTo(e.position) <= 3
      );
      if (!nearest) return;
      try { await bot.mount(nearest); } catch {}
    }, 1000);
  }

  // ---- 自动吃食物 ----
  function startAutoEatLoop() {
    if (autoEatInterval) return;
    autoEatInterval = setInterval(async () => {
      if (!bot || !bot.entity) return;
      if (bot.food === 0 && !isEating) {
        isEating = true;
        await bot.clickWindow(45,0,0);
        await bot.clickWindow(36,0,0);
        await bot.clickWindow(45,0,0);
        bot.chat('偷懒中...');
        while(bot.food < 20) {
          await bot.activateItem();
          await sleep(1600);
        }
        await bot.clickWindow(45,0,0);
        await bot.clickWindow(36,0,0);
        await bot.clickWindow(45,0,0);
        bot.chat('不再挨饿了');
        isEating = false;
      }
    }, 1000);
  }

  // ---- 自动攻击骷髅 ----
  function startAttackLoop() {
    if (attackInterval) clearInterval(attackInterval);
    let lastAttackTime = 0;
    const COOLDOWN = 1000;
    attackInterval = setInterval(() => {
      if (!bot || !bot.entity || isEating) return;
      const skeleton = Object.values(bot.entities).find(e =>
        e.type === 'mob' && e.name === 'skeleton' &&
        bot.entity.position.distanceTo(e.position) <= 3
      );
      if (skeleton && Date.now() - lastAttackTime > COOLDOWN) {
        bot.attack(skeleton, true);
        attackCount++;
        lastAttackTime = Date.now();
      }
    }, 200);
  }

  // ---- 夜间检测循环 ----
  function startNightCheckLoop() {
    if (nightInterval) clearInterval(nightInterval);
    nightInterval = setInterval(async () => {
      if (!bot || !bot.entity) return;
      const time = bot.time.timeOfDay;
      const isNight = time >= 12542 && time <= 23000;
      if (isNight && !nightMessageSent) {
        nightMessageSent = true;
        await bot.chat("天黑了，要睡觉喊我一声zzz！");
        await bot.chat(`今日骷髅击杀数：${Math.floor(attackCount / 2)}`);
        setTimeout(() => {
          console.log('［系统］开始重置击杀数');
          attackCount = 0;
        }, 1000);
      }
      if (!isNight && nightMessageSent) nightMessageSent = false;
    }, 5000);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ---- 创建备用机器人 ----
function createBackupBot() {
  pauseMainBotReconnect = true;

  backupBot = mineflayer.createBot({
    host: '87world.aternos.me',
    port: 15945,
    username: 'sohai_tim2'
  });

  backupBot.on('spawn', async () => {
    console.log('［系统］sohai_tim2 加入了游戏');

    backupBot.chat('SB Aternos');
    await sleep(1000);
    backupBot.chat('/pradon sohai_tim');
    await sleep(1000);
    backupBot.chat('溜了 白白！');
  });

  backupBot.on('chat', (username, message) => {
    console.log(`［系统］<${username}> ${message}`);
  });

  backupBot.on('message', (msg) => {
    const text = msg.toString();
    if (text.includes("joined the game")) {
      const playerName = text.split(" ")[0];
      if (playerName === backupBot.username) return;
      console.log(`［系统］${playerName} 加入了游戏`);
    }
    if (text.includes("left the game")) {
      const playerName = text.split(" ")[0];
      if (playerName === backupBot.username) return;
      console.log(`［系统］${playerName} 离开了游戏`);
    }
  });

  backupBot.on('end', () => {
    console.log('［系统］sohai_tim2 离开了游戏');
    backupBot = null;
    pauseMainBotReconnect = false;

    if (!bot || !bot.entity) {
      createBot();
    }
  });
}

// ---- 启动主机器人 ----
createBot();
