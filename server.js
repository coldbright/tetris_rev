const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require("body-parser");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const saltRounds = 10;
const mysql = require("mysql");
const encoder = bodyParser.urlencoded();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const connection = require('./config/db');

const userRouter = require('./routes/user');

const statsRouter = require('./routes/stats');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/user', userRouter);
app.use('/api/stats', statsRouter);

require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY; // 보안상 환경변수로 저장 권장


const rooms = {};

app.use(express.static(path.join(__dirname, 'public/lobby')));
app.use(express.static(path.join(__dirname, 'public/waiting_room')));
app.use(express.static(path.join(__dirname, 'public/login&register')));
app.use(express.static(path.join(__dirname, 'public/tetris_front')));
app.use(express.static(path.join(__dirname, 'public/rank_img')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lobby-new.html'));
});

app.get('/room=:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'waiting_room/waiting_room.html'));
});

app.get('/room=:room/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tetris_front/all_in_one_tetris.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login&register/login.html'));
});

app.get('/api/server-stats', (req, res) => {

    let totalPlayers = 0;
    let activeGames = 0;

    for(const roomId in rooms){

        const players = rooms[roomId];

        totalPlayers += players.length;

        if(players.length === 2){
            activeGames++;
        }
    }

    // console.log(totalPlayers, activeGames)

    res.json({
        players: totalPlayers,
        games: activeGames
    });
});


//Socket 인증 처리
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    // console.log("인증 시도")
    if (!token) return next(new Error("토큰이 없습니다."));

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return next(new Error("유효하지 않은 토큰입니다."));
        socket.user = decoded; // 유저 정보 저장
        next();
    });
});

//소켓 통신 처리
io.on('connection', (socket) => {
    console.log('User connected:', socket.user?.username || socket.id);

    function addUserToRoom(roomId, nickname) {
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }
        const exists = rooms[roomId].some(user => user.nickname === nickname);
        let health = 100;
        if (!exists) {
            rooms[roomId].push({ nickname, ready: false, health });
        }
    }

    function removeUserFromRoom(roomId, nickname) {
        if (!rooms[roomId]) return;
        rooms[roomId] = rooms[roomId].filter(user => user.nickname !== nickname);
        if (rooms[roomId].length === 0) {
            delete rooms[roomId];
        }
    }

    function toggleReady(roomId, nickname) {
        const user = rooms[roomId]?.find(user => user.nickname === nickname);
        if (user) user.ready = !user.ready;
    }

    function changeHealth(rooms, roomId, nickname, delta) {
        for (const roomId in rooms) {
            const players = rooms[roomId];
            for (const player of players) {
                if (player.nickname === nickname) {
                    player.health += delta;
                    if(player.health>100){
                        player.health = 100;
                    }
                    if(player.health<=0){
                        console.log("gameover");
                    }
                    return true;
                }
            }
        }
        return false;
    }

    function findOpponentNickname(rooms , roomId, nickname) {
        for (const roomId in rooms) {
            const playerObj = rooms[roomId];
            const players = Object.values(playerObj); // 객체 → 배열 변환

            const targetIndex = players.findIndex(p => p.nickname === nickname);

            if (targetIndex !== -1) {
                for (let i = 0; i < players.length; i++) {
                    if (i !== targetIndex) {
                        return players[i].nickname;
                    }
                }
                return null; // 방엔 자신밖에 없음
            }
        }
        return null; // 닉네임 못 찾음
    }

    socket.on("joinRoom", ({ roomId }) => {
        console.log(1)
        const room = io.sockets.adapter.rooms.get(roomId);
        const numClients = room ? room.size : 0;
        console.log(roomId);

        if (numClients >= 2) {
            socket.emit("roomFull");
            return;
        }

        socket.join(roomId);
        socket.roomId = roomId;
        socket.data.nickname = socket.user?.username;

        addUserToRoom(roomId, socket.data.nickname);

        const users = rooms[roomId];

        if (users.length === 2) {

            const player1 = users[0];
            const player2 = users[1];

            const roomSockets = Array.from(
                io.sockets.adapter.rooms.get(roomId)
            );

            const socket1 = io.sockets.sockets.get(roomSockets[0]);
            const socket2 = io.sockets.sockets.get(roomSockets[1]);

            socket1.emit("secondplayer", {
                name: player2.nickname
            });

            socket2.emit("secondplayer", {
                name: player1.nickname
            });
        }

        socket.emit("updateUsername", socket.data.nickname);
    });

    socket.on("get_score", (username)=>{
        console.log("good");
        connection.query(
            "SELECT rank_score FROM user_stats WHERE username = ?",
            [username],
            (error, results) => {
                if (error) {
                    console.log("bug");
                    return res.status(500).json({ message: "서버 오류 발생" });
                }
                if (results.length === 0) {
                    console.log("bug");
                    return res.status(404).json({ message: "해당 유저를 찾을 수 없습니다" });
                }
                const score = res.status(200).json({ rank_score: results[0].rank_score });
                console.log(score);
                socket.emit("updatescore", score);
            }
        );
    });

    socket.on("toggleReady", (isReady, roomId) => {
        const nickname = socket.data.nickname;
        toggleReady(roomId, nickname);

        socket.to(roomId).emit("opponentReadyStatus", {
            nickname,
            isReady
        });

        function checkAllReady(roomId) {
            const users = rooms[roomId];
            const allReady = users.every(user => user.ready === true);
            const room = io.sockets.adapter.rooms.get(roomId);
            const numClients = room ? room.size : 0;

            if(numClients === 2) {
                if (allReady) {
                    console.log(rooms[roomId]);
                    socket.to(roomId).emit("bothready");
                    socket.emit("bothready");
                }
            }
        }
        checkAllReady(roomId);
    });

    socket.on("line_deleted", (deletedThisTurn, roomId) =>{
        const nickname = socket.data.nickname;
        const opponent_nickname = findOpponentNickname(rooms, roomId, nickname);
        const players = rooms[roomId];
        console.log(deletedThisTurn, roomId, nickname);
        const deleteMapping = { 1: 4, 2: 12, 3: 20 };
        const line_deleted = deleteMapping[deletedThisTurn] || 32;
        changeHealth(rooms, roomId, nickname, line_deleted/2);
        changeHealth(rooms, roomId, opponent_nickname, -(line_deleted));

        let player1_health = null;
        let player2_health = null;

        for (const player of players) {
            if (player.nickname === nickname) {
                player1_health = player.health;
            } else {
                player2_health = player.health;
            }
        }

        console.log(rooms[roomId]);
        socket.to(roomId).emit("higher_gauge", { player1_health, player2_health });
        socket.emit("lower_gauge", { player1_health, player2_health });
    });

    socket.on("leave_room",(roomId) => {
        removeUserFromRoom(roomId, socket.data.nickname);
    });

    socket.on('disconnect', () => {
        const nickname = socket.user?.username;
        const roomId = socket.roomId;
        console.log(`User disconnected: ${nickname} from room ${roomId}`);

        if (roomId) {
            removeUserFromRoom(roomId, nickname);
            console.log(rooms[roomId]);

            const room = io.sockets.adapter.rooms.get(roomId);
            const usersInRoom = Array.from(room || []).map(
                (id) => io.sockets.sockets.get(id).data.nickname
            );
            io.to(roomId).emit("nosecondplayer");

            if (usersInRoom.length === 0) {
                delete rooms[roomId];
            }
        }
    });


});


server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
