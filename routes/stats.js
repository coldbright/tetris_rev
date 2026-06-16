const express = require("express");
const router = express.Router();

const connection = require("../config/db");

router.get("/:username", (req, res) => {

    const username = req.params.username;

    connection.query(
        `
        SELECT
            total_games,
            wins,
            losses,
            rank_points,
            highest_rank_points
        FROM user_stats
        WHERE username = ?
        `,
        [username],
        (err, results) => {

            if(err){
                console.error(err);

                return res.status(500).json({
                    message: "DB 오류"
                });
            }

            if(results.length === 0){
                return res.status(404).json({
                    message: "유저 없음"
                });
            }

            const stats = results[0];

            const winRate =
                stats.total_games > 0
                    ? ((stats.wins / stats.total_games) * 100).toFixed(1)
                    : 0;

            res.json({
                total_games: stats.total_games,
                wins: stats.wins,
                losses: stats.losses,
                rank_points: stats.rank_points,
                highest_rank_points: stats.highest_rank_points,
                win_rate: winRate
            });
        }
    );
});

module.exports = router;