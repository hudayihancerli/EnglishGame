import { normalizeDifficulty } from '../src/game/settings.js';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8090);
const APK_PATH = path.join(
  process.cwd(),
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);
const BUILD_GRADLE_PATH = path.join(process.cwd(), 'android', 'app', 'build.gradle');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://multi.hudayi.space';

function readAppVersion() {
  try {
    const gradle = fs.readFileSync(BUILD_GRADLE_PATH, 'utf8');
    const codeMatch = gradle.match(/versionCode\s+(\d+)/);
    const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
    return {
      versionCode: codeMatch ? Number(codeMatch[1]) : 1,
      versionName: nameMatch ? nameMatch[1] : '1.0',
    };
  } catch {
    return { versionCode: 1, versionName: '1.0' };
  }
}

const rooms = new Map();

function getOrCreateRoom(code) {
  const key = (code || '1234').trim().toUpperCase();
  if (!rooms.has(key)) {
    rooms.set(key, {
      code: key,
      status: 'LOBBY',
      difficulty: 'normal',
      seed: Math.floor(Math.random() * 1000000) + 1,
      rankings: [],
      players: new Map(),
    });
  }
  return rooms.get(key);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  if (urlPath === '/version.json') {
    const ver = readAppVersion();
    const exists = fs.existsSync(APK_PATH);
    const size = exists ? fs.statSync(APK_PATH).size : 0;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        versionCode: ver.versionCode,
        versionName: ver.versionName,
        apkUrl: `${PUBLIC_BASE_URL}/app-release.apk`,
        size,
      }),
    );
    return;
  }

  if (urlPath === '/app-release.apk' || urlPath === '/download') {
    if (!fs.existsSync(APK_PATH)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('APK bulunamadi');
      return;
    }
    const stat = fs.statSync(APK_PATH);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="QuizRunner3D.apk"',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(APK_PATH).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('QuizRunner3D Multiplayer & Update Server');
});

const wss = new WebSocketServer({ server });
let nextPlayerId = 1;

function broadcastRoom(room, payloadObj) {
  const msg = JSON.stringify(payloadObj);
  for (const [, p] of room.players.entries()) {
    if (p.ws.readyState === 1) {
      p.ws.send(msg);
    }
  }
}

function getLobbyPlayers(room) {
  const list = [];
  for (const [id, p] of room.players.entries()) {
    list.push({
      id,
      name: p.name,
      color: p.color,
      finished: p.finished,
    });
  }
  return list;
}

function getHostId(room) {
  return room.players.keys().next().value ?? null;
}

function broadcastLobby(room) {
  broadcastRoom(room, {
    type: 'LOBBY_UPDATE',
    code: room.code,
    status: room.status,
    hostId: getHostId(room),
    difficulty: room.difficulty,
    players: getLobbyPlayers(room),
  });
}

function broadcastSnapshot(room) {
  const list = [];
  for (const [id, p] of room.players.entries()) {
    list.push({
      id,
      name: p.name,
      color: p.color,
      lane: p.lane,
      x: p.x,
      distance: p.distance,
      speedMult: p.speedMult,
      score: p.score,
      finished: p.finished,
    });
  }
  broadcastRoom(room, {
    type: 'PLAYERS',
    players: list,
  });
}

// Fixed 15 Hz broadcast loop for smooth sync without overwhelming remote connections
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status === 'PLAYING' && room.players.size > 0) {
      broadcastSnapshot(room);
    }
  }
}, 66);

wss.on('connection', (ws) => {
  const playerId = String(nextPlayerId++);
  let currentRoom = null;

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === 'JOIN') {
      const nextRoom = getOrCreateRoom(data.code);
      if (currentRoom && currentRoom !== nextRoom) {
        currentRoom.players.delete(playerId);
        if (currentRoom.players.size === 0) {
          rooms.delete(currentRoom.code);
        } else {
          broadcastLobby(currentRoom);
        }
      }
      currentRoom = nextRoom;
      const safeName = (data.name || `Oyuncu ${playerId}`).trim().slice(0, 14) || `Oyuncu ${playerId}`;
      const safeColor = typeof data.color === 'string' ? data.color : '#38bdf8';

      const existingPlayer = currentRoom.players.get(playerId);
      currentRoom.players.set(playerId, {
        ws,
        lane: 1,
        x: -1.2,
        distance: 0,
        speedMult: 1.0,
        score: 0,
        finished: false,
        ...existingPlayer,
        name: safeName,
        color: safeColor,
      });

      ws.send(
        JSON.stringify({
          type: 'WELCOME',
          playerId,
          code: currentRoom.code,
          status: currentRoom.status,
          seed: currentRoom.seed,
          hostId: getHostId(currentRoom),
          difficulty: currentRoom.difficulty,
          players: getLobbyPlayers(currentRoom),
          rankings: currentRoom.rankings,
        }),
      );
      broadcastLobby(currentRoom);
    } else if (data.type === 'SET_DIFFICULTY' && currentRoom) {
      if (currentRoom.status !== 'LOBBY' || getHostId(currentRoom) !== playerId) return;
      currentRoom.difficulty = normalizeDifficulty(data.difficulty);
      broadcastLobby(currentRoom);
    } else if (data.type === 'START_GAME' && currentRoom) {
      if (currentRoom.status !== 'LOBBY' || getHostId(currentRoom) !== playerId) return;
      // Older clients put the difficulty on the start message.
      if (typeof data.difficulty === 'string') {
        currentRoom.difficulty = normalizeDifficulty(data.difficulty);
      }
      currentRoom.status = 'PLAYING';
      currentRoom.seed = Math.floor(Math.random() * 1000000) + 1;
      currentRoom.rankings = [];
      for (const [, p] of currentRoom.players.entries()) {
        p.lane = 1;
        p.x = -1.2;
        p.distance = 0;
        p.speedMult = 1.0;
        p.score = 0;
        p.finished = false;
      }
      broadcastRoom(currentRoom, {
        type: 'GAME_START',
        seed: currentRoom.seed,
        difficulty: currentRoom.difficulty,
      });
      broadcastSnapshot(currentRoom);
    } else if (data.type === 'STATE' && currentRoom) {
      const player = currentRoom.players.get(playerId);
      if (player && !player.finished) {
        player.lane = data.lane ?? player.lane;
        player.x = data.x ?? player.x;
        player.distance = data.distance ?? player.distance;
        player.speedMult = data.speedMult ?? player.speedMult;
        player.score = data.score ?? player.score;
      }
    } else if (data.type === 'FINISH' && currentRoom) {
      const player = currentRoom.players.get(playerId);
      if (player && !player.finished) {
        player.finished = true;
        player.score = data.score ?? player.score;
        const place = currentRoom.rankings.length + 1;
        currentRoom.rankings.push({
          id: playerId,
          place,
          name: player.name,
          color: player.color,
          score: player.score,
          elapsedMs: data.elapsedMs ?? 0,
        });
        broadcastRoom(currentRoom, {
          type: 'RANKINGS',
          rankings: currentRoom.rankings,
          totalPlayers: currentRoom.players.size,
        });
        broadcastSnapshot(currentRoom);
      }
    } else if (data.type === 'BACK_TO_LOBBY' && currentRoom) {
      currentRoom.status = 'LOBBY';
      currentRoom.rankings = [];
      for (const [, p] of currentRoom.players.entries()) {
        p.distance = 0;
        p.speedMult = 1.0;
        p.score = 0;
        p.finished = false;
      }
      broadcastLobby(currentRoom);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.players.delete(playerId);
      if (currentRoom.players.size === 0) {
        rooms.delete(currentRoom.code);
      } else {
        broadcastLobby(currentRoom);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QuizRunner3D WS & Update server listening on http://0.0.0.0:${PORT}`);
});
