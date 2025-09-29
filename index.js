const mineflayer = require('mineflayer');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

let bot = null;
let hasLoggedReconnect = false;
let failCount = 0; // 失败计数

let attackInterval = null;
let lookInterval = null;
let minecartInterval = null;
let nightInterval = null;
let autoEatInterval = null;

let isEating = false;
let nightMessageSent = false;
let attackCount = 0;

const onlinePlayers = new Set();

// ---- 全局 sleep 函数 ----
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- HTTP 保活 ----
app.get('/', (req, res) => {
  res.send('你妈妈来喽！');
});
app.listen(PORT, () => {
  console.log(`[系统] HTTP 服务启动 端口 ${PORT}`);
});

// ---- 主 bot ----
function createBot() {
  bot = mineflayer.createBot({
    host: '87world.aternos.me',
    port: 15945,
    username: 'sohai_tim'
  });

  bot.on('spawn', () => {
    console.log('［系统］sohai_tim 加入了游戏');
    failCount = 0;
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

    // 清理循环
    if (attackInterval) clearInterval(attackInterval);
    if (lookInterval) clearInterval(lookInterval);
    if (minecartInterval) clearInterval(minecartInterval);
    if (nightInterval) clearInterval(nightInterval);

    failCount++;
    if (failCount >= 3) {
      createBackupBot(); // 三次失败派出备用
      failCount = 0;
      return;
    }

    setTimeout(() => {
      if (!hasLoggedReconnect) {
        console.log('［系统］断线重连回复中...');
        hasLoggedReconnect = true;
      }
      createBot();
    }, 10000);
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

      const targetPos = target.position.offset(0, (target.height || 1) * 0.7, 0);
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
    const ATTACK_RANGE = 4;

    attackInterval = setInterval(() => {
      if (!bot || !bot.entity || isEating) return;

      const nearbySkeletons = Object.values(bot.entities).filter(e =>
        e.type === 'mob' && e.name === 'skeleton' &&
        bot.entity.position.distanceTo(e.position) <= ATTACK_RANGE
      );

      if (!nearbySkeletons.length) return;

      const nearest = nearbySkeletons.sort((a, b) =>
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
      )[0];

      if (Date.now() - lastAttackTime > COOLDOWN) {
        bot.attack(nearest, true);
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
}

// ---- 备用 bot ----
async function createBackupBot() {
  const backup = mineflayer.createBot({
    host: '87world.aternos.me',
    port: 15945,
    username: 'sohai_tim2'
  });

  backup.on('spawn', async () => {
    console.log('［系统］准备派出 sohai_tim2 救场');
    await sleep(2000);
    backup.chat('SB aternos');
    await sleep(2000);
    backup.chat('/pardon sohai_tim');
    await sleep(2000);
    backup.chat('溜了 白白！');
    await sleep(2000);
    backup.end();
  });

  backup.on('end', () => {
    console.log('［系统］sohai_tim2 离开了游戏');
  });
}

// ---- 启动 ----
createBot();
