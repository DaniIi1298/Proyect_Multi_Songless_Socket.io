import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// Autocompletado
app.get('/song-suggestions', async (req, res) => {
    const query = req.query.query || '';
    if (!query) return res.json([]);

    try {
        const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&limit=5&fmt=json`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'JuegoAdivinaCancion/1.0 (tuemail@dominio.com)' }
        });

        const data = await response.json();
        const suggestions = data.recordings.map(rec => ({
            title: rec.title,
            artist: rec['artist-credit']?.map(a => a.name).join(', ') || ''
        }));

        res.json(suggestions);
    } catch {
        res.json([]);
    }
});

// Juego
let songs = [
    { url: '/songs/song1.mp3', title: 'Billie jean' },
    { url: '/songs/song2.mp3', title: 'Never gonna give you up' },
    { url: '/songs/song3.mp3', title: 'Somewhere I Belong' },
    { url: '/songs/song4.mp3', title: 'Blinding Lights' }
];

const hintDurations = [0, 1, 2, 4, 8];
const hintPoints = [0, 100, 75, 50, 20];

let players = {};
const TOP_SCORES_FILE = __dirname + '/top10.json';

// ======= FUNCIONES TOP 10 =======
function loadTopScores() {
    try {
        const data = fs.readFileSync(TOP_SCORES_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

function saveTopScores(scores) {
    fs.writeFileSync(TOP_SCORES_FILE, JSON.stringify(scores, null, 2));
}

function updateTopScores(playerName, playerPoints) {
    let topScores = loadTopScores();

    let inserted = false;
    for (let i = 0; i < topScores.length; i++) {
        if (playerPoints > topScores[i].points) {
            topScores.splice(i, 0, { name: playerName, points: playerPoints });
            inserted = true;
            break;
        }
    }

    if (!inserted && topScores.length < 10) {
        topScores.push({ name: playerName, points: playerPoints });
        inserted = true;
    }

    topScores = topScores.slice(0, 10);

    if (inserted) saveTopScores(topScores);

    return topScores;
}
// ===============================

io.on('connection', socket => {

    socket.on('registerPlayer', name => {
        players[socket.id] = {
            name,
            points: 0,
            guessed: false,
            hintLevel: 0,
            roundIndex: 0
        };
        updateScoreboard();
        socket.emit('topScores', loadTopScores());
    });

    // Chat
    socket.on('chat message', msg => {
        const sender = players[socket.id]?.name || "Desconocido";
        io.emit('chat message', `${sender}: ${msg}`);
    });

    // Reproducir snippet
    socket.on('play snippet', () => {
        const player = players[socket.id];
        if (!player) return;

        const song = songs[player.roundIndex];
        if (!song) return;

        const duration = hintDurations[player.hintLevel];
        socket.emit('audio snippet', song.url, duration);
    });

    // Pistas
    socket.on('request hint', () => {
        const player = players[socket.id];
        if (!player) return;

        if (player.hintLevel < hintDurations.length - 1) {
            player.hintLevel++;
            socket.emit('new hint', hintDurations[player.hintLevel], false);
        } else {
            socket.emit('new hint', hintDurations[player.hintLevel], true);
        }
    });

    // Adivinar
    socket.on('guess', guess => {
        const player = players[socket.id];
        if (!player) return;

        const song = songs[player.roundIndex];
        if (!song) return;

        if (guess.toLowerCase() !== song.title.toLowerCase()) {
            socket.emit('wrong guess');
            return;
        }

        // Acierto
        player.points += hintPoints[player.hintLevel];
        const top10 = updateTopScores(player.name, player.points);
        io.emit('topScores', top10); // se actualiza el top 10 inmediatamente
        socket.emit('round info', `¡Has acertado!`);

        updateScoreboard();

        player.roundIndex++;
        player.hintLevel = 1;

        const nextSong = songs[player.roundIndex];
        if (nextSong) {
            socket.emit('round info', `Has pasado a la siguiente canción`);
            socket.emit('new hint', 1, false);
        } else {
            socket.emit('round info', `Juego terminado. Has conseguido ${player.points} puntos`);
        }
    });

    // Skip canción
    socket.on('skip song', () => {
        const player = players[socket.id];
        if (!player) return;

        player.roundIndex++;
        player.hintLevel = 1;

        const nextSong = songs[player.roundIndex];
        if (nextSong) {
            socket.emit('round info', `Has pasado a la siguiente canción`);
            socket.emit('new hint', 1, false);
        } else {
            const top10 = updateTopScores(player.name, player.points);
            io.emit('topScores', top10);
            socket.emit('round info', `Juego terminado. Has conseguido ${player.points} puntos`);
        }

        updateScoreboard();
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        updateScoreboard();
    });

    function updateScoreboard() {
        const board = Object.values(players).sort((a, b) => b.points - a.points);
        io.emit('scoreboard', board);
    }
});

server.listen(3000, () => {
    console.log('Servidor en http://localhost:3000');
});
