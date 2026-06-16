const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const connection = require('../config/db');
require('dotenv').config();

const saltRounds = 10;
const SECRET_KEY = process.env.SECRET_KEY;

// 로그인 API
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    connection.query("SELECT * FROM users WHERE email = ?", [email], async (error, results) => {
        if (error) return res.status(500).json({ message: "서버 오류 발생" });

        if (results.length === 0) return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });

        const user = results[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });

        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            SECRET_KEY,
            { expiresIn: '1h' }
        );

        res.status(200).json({ message: "로그인 성공!", token, redirectUrl: "/" });
    });
});

// 회원가입 API
router.post("/register", async (req, res) => {
    const { username, email, password, password_confirm } = req.body;

    if (password !== password_confirm) {
        return res.status(400).json({ message: "비밀번호가 일치하지 않습니다." });
    }
    connection.query("SELECT * FROM users WHERE email = ?", [email], async (error, results) => {
        if (error) {
            return res.status(500).json({message: "서버 오류 발생"});
        }

        if (results.length > 0) return res.status(409).json({ message: "이미 존재하는 이메일입니다." });

        connection.query("SELECT * From users WHERE username = ?", [username], async (error, results) => {
            if (results.length > 0) return res.status(409).json({ message: "이미 존재하는 이름입니다." });

            try {
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                connection.query(
                    "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
                    [username, email, hashedPassword],
                    (error) => {
                        if (error) {
                            console.log(error)
                            return res.status(500).json({ message: "회원가입 실패" });
                        }

                        connection.query(
                            "INSERT INTO user_stats (username) VALUES (?)",
                            [username],
                            (error) => {
                                if (error) {
                                    console.log(error)
                                    return res.status(500).json({ message: "회원가입 실패" });
                                }

                                res.status(200).json({
                                    message: "회원가입 성공",
                                    redirectUrl: "/login"
                                });
                            }
                        );
                    }
                );
            } catch {
                res.status(500).json({ message: "비밀번호 해싱 실패" });
            }
        })

    });
});

module.exports = router;
