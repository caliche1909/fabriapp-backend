const { users, user_current_position, companies, user_companies } = require('../models');
const { Op } = require('sequelize');



/**
 * Actualizar posición de un usuario
 */
const updateUserPosition = async (req, res) => {
    try {
        const { userId } = req.params;
        const { latitude, longitude, accuracy, source = 'mobile_app' } = req.body;

        // Validar parámetros requeridos
        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Latitude y longitude son requeridos'
            });
        }

        // Validar rangos de coordenadas
        if (latitude < -90 || latitude > 90) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Latitude debe estar entre -90 y 90'
            });
        }

        if (longitude < -180 || longitude > 180) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Longitude debe estar entre -180 y 180'
            });
        }

        // Buscar la posición actual del usuario
        const currentPosition = await user_current_position.findOne({
            where: { user_id: userId, is_active: true }
        });

        if (!currentPosition) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Usuario no tiene geolocalización activa'
            });
        }

        // Actualizar posición
        await currentPosition.updatePosition(latitude, longitude, accuracy, source);

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Posición actualizada exitosamente',
            position: {
                id: currentPosition.id,
                user_id: currentPosition.user_id,
                coordinates: currentPosition.getCoordinates(),
                accuracy: currentPosition.accuracy,
                source: currentPosition.last_update_source,
                updated_at: currentPosition.updated_at,
                time_since_update: currentPosition.getTimeSinceLastUpdate()
            }
        });

    } catch (error) {
        console.error('❌ Error al actualizar posición:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};

/**
 * Obtener posición actual de un usuario
 */
const getUserPosition = async (req, res) => {
    try {
        const { userId } = req.params;

        const position = await user_current_position.findOne({
            where: { user_id: userId, is_active: true },
            include: [{
                model: users,
                as: 'user',
                attributes: ['id', 'first_name', 'last_name', 'email', 'phone']
            }]
        });

        if (!position) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Posición no encontrada para este usuario'
            });
        }

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Posición obtenida exitosamente',
            position: {
                id: position.id,
                user: {
                    id: position.user.id,
                    name: `${position.user.first_name} ${position.user.last_name}`,
                    email: position.user.email,
                    phone: position.user.phone
                },
                coordinates: position.getCoordinates(),
                accuracy: position.accuracy,
                is_recent: position.isRecent(),
                has_good_accuracy: position.hasGoodAccuracy(),
                source: position.last_update_source,
                time_since_update: position.getTimeSinceLastUpdate(),
                created_at: position.created_at,
                updated_at: position.updated_at
            }
        });

    } catch (error) {
        console.error('❌ Error al obtener posición:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};

/**
 * Obtener todas las posiciones activas de una empresa
 */
const getCompanyActivePositions = async (req, res) => {
    try {
        const { companyId } = req.params;

        // Verificar que la empresa existe
        const company = await companies.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Empresa no encontrada'
            });
        }

        // Obtener usuarios de la empresa que tienen geolocalización activa
        const companyUsers = await user_companies.findAll({
            where: { company_id: companyId },
            include: [{
                model: users,
                as: 'user',
                where: { require_geolocation: true, status: 'active' },
                include: [{
                    model: user_current_position,
                    as: 'current_position',
                    where: { is_active: true },
                    required: false
                }]
            }]
        });

        const activePositions = companyUsers
            .filter(uc => uc.user && uc.user.current_position)
            .map(uc => {
                const user = uc.user;
                const position = user.current_position;

                return {
                    user_id: user.id,
                    name: user.getFullName(),
                    email: user.email,
                    phone: user.phone,
                    coordinates: position.getCoordinates(),
                    accuracy: position.accuracy,
                    is_recent: position.isRecent(),
                    has_good_accuracy: position.hasGoodAccuracy(),
                    source: position.last_update_source,
                    time_since_update: position.getTimeSinceLastUpdate(),
                    updated_at: position.updated_at
                };
            });

        res.status(200).json({
            success: true,
            status: 200,
            message: `Se encontraron ${activePositions.length} posiciones activas`,
            company: {
                id: company.id,
                name: company.company_name
            },
            active_positions: activePositions,
            total_count: activePositions.length
        });

    } catch (error) {
        console.error('❌ Error al obtener posiciones de empresa:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};

/**
 * Buscar usuarios cerca de una ubicación
 */
const findNearbyUsers = async (req, res) => {
    try {
        const { latitude, longitude } = req.params;
        const { radius = 1000, companyId } = req.query;

        // Validar coordenadas
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Coordenadas inválidas'
            });
        }

        // Buscar usuarios cercanos
        const nearbyUsers = await user_current_position.findNearbyUsers(lat, lng, parseInt(radius));

        // Si se especifica companyId, filtrar solo usuarios de esa empresa
        let filteredUsers = nearbyUsers;

        if (companyId) {
            const companyUserIds = await user_companies.findAll({
                where: { company_id: companyId },
                attributes: ['user_id']
            });

            const companyUserIdSet = new Set(companyUserIds.map(uc => uc.user_id));
            filteredUsers = nearbyUsers.filter(user => companyUserIdSet.has(user.user_id));
        }

        // Obtener información completa de usuarios
        const userIds = filteredUsers.map(u => u.user_id);
        const usersInfo = await users.findAll({
            where: { id: { [Op.in]: userIds } },
            attributes: ['id', 'first_name', 'last_name', 'email', 'phone']
        });

        const usersMap = new Map(usersInfo.map(u => [u.id, u]));

        const results = filteredUsers.map(nearbyUser => {
            const userInfo = usersMap.get(nearbyUser.user_id);
            return {
                user_id: nearbyUser.user_id,
                name: userInfo ? userInfo.getFullName() : 'Usuario desconocido',
                email: userInfo?.email,
                phone: userInfo?.phone,
                distance_meters: Math.round(nearbyUser.distance_meters),
                accuracy: nearbyUser.accuracy,
                last_updated: nearbyUser.last_updated
            };
        });

        res.status(200).json({
            success: true,
            status: 200,
            message: `Se encontraron ${results.length} usuarios cerca`,
            search_center: { latitude: lat, longitude: lng },
            radius_meters: parseInt(radius),
            nearby_users: results,
            total_count: results.length
        });

    } catch (error) {
        console.error('❌ Error al buscar usuarios cercanos:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};

/**
 * Obtener estadísticas de geolocalización de una empresa
 */
const getGeolocationStats = async (req, res) => {
    try {
        const { companyId } = req.params;

        // Verificar que la empresa existe
        const company = await companies.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Empresa no encontrada'
            });
        }

        // Obtener estadísticas
        const companyUsers = await user_companies.findAll({
            where: { company_id: companyId },
            include: [{
                model: users,
                as: 'user',
                where: { status: 'active' },
                include: [{
                    model: user_current_position,
                    as: 'current_position',
                    required: false
                }]
            }]
        });

        const totalUsers = companyUsers.length;
        const usersWithGeolocationEnabled = companyUsers.filter(uc =>
            uc.user && uc.user.require_geolocation
        ).length;

        const activePositions = companyUsers.filter(uc =>
            uc.user && uc.user.current_position && uc.user.current_position.is_active
        ).length;

        const recentPositions = companyUsers.filter(uc =>
            uc.user && uc.user.current_position && uc.user.current_position.isRecent(10)
        ).length;

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Estadísticas obtenidas exitosamente',
            company: {
                id: company.id,
                name: company.company_name
            },
            statistics: {
                total_users: totalUsers,
                geolocation_enabled: usersWithGeolocationEnabled,
                active_positions: activePositions,
                recent_positions: recentPositions,
                geolocation_adoption_rate: totalUsers > 0 ? ((usersWithGeolocationEnabled / totalUsers) * 100).toFixed(1) + '%' : '0%',
                active_tracking_rate: usersWithGeolocationEnabled > 0 ? ((activePositions / usersWithGeolocationEnabled) * 100).toFixed(1) + '%' : '0%'
            }
        });

    } catch (error) {
        console.error('❌ Error al obtener estadísticas:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};

module.exports = {    
    updateUserPosition,
    getUserPosition,
    getCompanyActivePositions,
    findNearbyUsers,
    getGeolocationStats
}; 