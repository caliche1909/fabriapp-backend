const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/jwt.middleware');
const { geocodingController } = require('../controllers');
const {
    createGeneralLimiter
} = require('../middlewares/smartRateLimit.middleware');

// 🛡️ Rate limiting para geocoding
const geocodingLimiter = createGeneralLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 50,                   // 50 requests por IP
    maxByUser: 100,                // 100 requests por usuario
    message: "Límite de geocoding alcanzado",
    enableOwnerBonus: true,
    skipSuccessfulRequests: false
});

// 🌍 Reverse Geocoding endpoint
router.post('/reverse-geocoding',
    verifyToken,
    geocodingLimiter,
    geocodingController.reverseGeocoding
);

module.exports = router;
