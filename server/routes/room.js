const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer')
var uuidv4 = require('uuid/v4');
var path = require('path')
const fs = require('fs')

/**URLs */
const chatStorageUrl = '../chat_storage/';
const roomAvatarUrl = chatStorageUrl + 'room_avatar/';
const uploadUrl = chatStorageUrl + 'upload/';


const Room = require('../models/Room');
const User = require('../models/User');
const Relation = require('../models/Relation');
const roomRelation = require('../models/RoomRelation');
const Message = require('../models/Message');


const {
    createErrorObject,
    checkCreateRoomFields
} = require('../middleware/authenticate');

const {
    GET_RELATIONS
} = require('../actions/socketio');

// upload path for avatar image
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, '../chat_storage/room_avatar');
    },
    filename: function (req, file, cb) {
        cb(null, uuidv4() + path.extname(file.originalname));
    }
});
const fileFilter = (req, file, cb) => {
    let ext = path.extname(file.originalname);
    ext = ext.toLowerCase();
    if (ext !== '.png' && ext !== '.jpg' && ext !== '.gif' && ext !== '.jpeg') {
        cb(null, false);
    } else {
        cb(null, true);
    }
}
// upload var for avatar image

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 50
    },
    fileFilter: fileFilter
})
/**
 * @description GET /api/room
 */
router.get('/', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {
    const rooms_p = Room.findAll({}, {
        raw: true
    });
    const users_p = User.findAll({}, {
        raw: true
    });
    Promise.all([rooms_p, users_p]).then((value => {
            const rooms = value[0];
            const users = value[1];
            for (let i = 0; i < rooms.length; i++) {
                const room = rooms[i];
                room['user'] = users.filter((user) => user['id'] == room['user']);
                if (room['user']) {
                    room['user'] = room['user'][0];
                }
                if (room['access'] == 1) {
                    //public room - set the number of users as room users
                    room['users'] = users.filter((user) => user['room_id'] === room['id']).length;
                } else {
                    //private room - set the number of users as all (-1 : you)
                    room['users'] = users.length - 1;
                }
            }
            if (rooms) {
                return res.status(200).json(rooms);
            } else {
                return res.status(404).json({
                    error: 'No Rooms Found'
                });
            }
        }))
        .catch(err => {
            console.log('err', err);
        });

});

/**
 * @description GET /api/room/:room_id
 */
router.get('/:room_id', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {
    const room = await Room.findByPk(req.params.room_id, {
        raw: true
    });
    if (room) {
        if (room['access']) {
            //public room
            const relations = await GET_RELATIONS({
                room: req.params.room_id,
                roomAdmin: room.user,
                user: req.user.id
            });

            if (relations.privateR == 2 || relations.roomR == 2) {
                return res.status(200).json({
                    msg: 'You are blocked'
                });
            }
            User.findAndCountAll({
                    where: {
                        room_id: room['id']
                    }
                })
                .then(async result => {
                    room['users'] = result.rows;
                    room['privateRs'] = relations.privateRs;
                    room['status'] = relations.roomR;
                    return res.status(200).json(room);
                })
        } else {
            //private room
            const relations = await Relation.findAll({
                raw: true
            });
            await User.findAll({}, {
                    raw: true
                })
                .then(result => {
                    room['users'] = result;
                    for (const user of room['users']) {
                        const from_st = relations.filter((relation) => (relation['user'] == req.user.id) && (relation['touser'] == user.id));
                        const to_st = relations.filter((relation) => (relation['touser'] == req.user.id) && (relation['user'] == user.id));
                        user['dataValues']['from'] = from_st[0] ? from_st[0].status : false;
                        user['dataValues']['to'] = to_st[0] ? to_st[0].status : false;
                    }
                    return res.status(200).json(room);
                })
        }
    } else {
        return res.status(404).json({
            error: `No room with name ${req.params.room_name} found`
        });
    }
});

/**
 * @description POST /api/room
 */
router.post(
    '/',
    [upload.single('room_avatar'), passport.authenticate('jwt', {
        session: false
    }), checkCreateRoomFields],
    async (req, res) => {
        let errors = [];
        const fileName = req.file ? req.file.filename : 'defaultRoom.png';

        const totalRoom = await Room.findAll({}, {
            raw: true
        });
        const room = totalRoom.find(room => room.name == req.body.room_name);
        const roomByUser = totalRoom.filter(room => room.user == req.user.id).length;

        if (room) {
            if (room.name === req.body.room_name) {
                errors.push({
                    param: 'room_taken',
                    msg: 'Roomname already taken'
                });
            }
        }
        //Maximum Total Room - 100
        if (totalRoom.length > 99) {
            errors.push({
                param: 'totalRoomExceeds',
                msg: 'Already created 100 rooms'
            });
        }
        //One user can create 3 Rooms as a maximum
        if (roomByUser > 2) {
            errors.push({
                param: 'UserRoomExceeds',
                msg: 'You already created 3 rooms'
            });
        }

        if (errors.length) {
            return res.json({
                errors: createErrorObject(errors)
            });
        }
        const newRoom = new Room({
            name: req.body.room_name,
            user: req.user.id,
            avatar: fileName,
            access: req.body.password ? false : true,
            password: req.body.password
        });

        newRoom
            .save()
            .then(room => {
                User.findOne({
                        where: {
                            'id': room['user']
                        }
                    })
                    .then(user => {
                        room['user'] = user;
                    })
                    .catch(err => {
                        console.log(err);
                    })
                    .finally(() => {
                        room['users'] = 0;
                        return res.status(200).json(room);
                    });
            })
            .catch(err => {
                return res.json(err);
            });
    }
);

// /**
//  * @description POST /api/room/verify
//  */
// router.post('/verify', passport.authenticate('jwt', { session: false }), async (req, res) => {
//     if (!req.body.password === true) {
//         return res.json({
//             errors: createErrorObject([
//                 {
//                     param: 'password_required',
//                     msg: 'Password is required'
//                 }
//             ])
//         });
//     }

//     const room = await Room.findOne({ name: req.body.room_name }).exec();

//     if (room) {
//         const verified = await room.isValidPassword(req.body.password);

//         if (verified === true) {
//             room.accessIds.push(req.user.id);
//             await room.save();
//             return res.status(200).json({ success: true });
//         } else {
//             return res.json({
//                 errors: createErrorObject([
//                     {
//                         param: 'invalid_password',
//                         msg: 'Invalid Password'
//                     }
//                 ])
//             });
//         }
//     } else {
//         return res.status(404).json({ errors: `No room with name ${req.params.room_name} found` });
//     }
// });

/**
 * @description DELETE /api/room/:room_name
 */
router.delete('/:room_name', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {
    if (req.params.room_name != 'HOME') {
        try {
            const room = await Room.findOne({
                where: {
                    'name': req.params.room_name
                }
            }, {
                raw: true
            });
            const roomUsers = await User.findAndCountAll({
                where: {
                    'room_id': room.id
                }
            })
            console.log('delete room request', req.body.check, roomUsers.count);
            if (!req.body.check || roomUsers.count == 0) {
                console.log('deleting room');

                const status = await Room.destroy({
                    where: {
                        'name': req.params.room_name
                    }
                });
                const messages = await Message.findAll({
                    where: {
                        'room': room['id']
                    }
                }, {
                    raw: true
                });

                Message.destroy({
                    where: {
                        'room': room['id']
                    }
                });
                roomRelation.destroy({
                    where: {
                        'room': room['id']
                    }
                });
                console.log('room Deleting status', status);
                if (status) {
                    console.log('deleting file', roomAvatarUrl);
                    const msgUrls = messages.filter(msg => msg.content.includes('!!!image!!!'))
                        .map(function (obj) {
                            return uploadUrl + obj.content.substring(11);
                        })

                    if (room.avatar != 'defaultRoom.png') {
                        msgUrls.push(roomAvatarUrl + room.avatar);
                    }
                    msgUrls.forEach(path => {
                        fs.access(path, err => {
                            if (!err) {
                                fs.unlinkSync(path, err => {
                                    console.log('file deleting err', err);
                                })
                            } else {
                                console.log('file accessing err', err);
                            }
                        })
                    })
                    return res.status(200).json(room);
                }
                console.log('returning false try');
                return res.status(200).json({
                    errors: `No room with name ${
                    req.params.room_name
                } found, You will now be redirected`
                });
            }
        } catch (err) {
            console.log('returning false catch', err);
            return res.status(200).json({
                errors: `No room with name ${
                    req.params.room_name
                } found, You will now be redirected`
            });
        }
    }
});

/**
 * @description PUT /api/room/update/name
 */
router.post('/update/name', [upload.single('room_avatar'), passport.authenticate('jwt', {
    session: false
})], async (req, res) => {
    req.check('new_room_name')
        .isString()
        .isLength({
            min: 3,
            max: 20
        })
        .withMessage('New Room Name must be between 3 and 20 characters');

    let errors = req.validationErrors();

    if (errors.length > 0) {
        return res.send({
            errors: createErrorObject(errors)
        });
    }
    const updateFields = {};
    if (req.body) {
        updateFields['name'] = req.body.new_room_name
    }
    updateFields['avatar'] = req.file ? req.file.filename : 'defaultRoom.png';
    Room.update(updateFields, {
            returning: true,
            plain: true,
            where: {
                'name': req.body.room_name
            }
        })
        .then(function (doc) {
            if (doc[1]) {
                Room.findOne({
                        where: {
                            'name': req.body.new_room_name
                        }
                    })
                    .then(async doc => {
                        await User.findAndCountAll({
                                where: {
                                    'room_id': doc['id']
                                }
                            })
                            .then(result => {
                                doc['users'] = result.rows;
                            })
                        return res.status(200).json(doc);
                    })
            }
        })
        // .then(doc => res.json({ success: true, user: doc }))
        .catch(err => {
            console.log('err', err);
            return res.status(404).json({
                errors: `Room ${req.params.room_name} update failed`
            });
        });
});

/**
 * @description PUT /api/room/remove/users
 */
router.post('/remove/users', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {

    let room = await Room.findByPk(req.body.room_id, {
        raw: true
    });
    const id = req.body.user ? req.body.user : req.user.id;

    if (room) {
        const updateFields = ({
            room_id: null
        });
        await User.update(updateFields, {
                returning: true,
                raw: true,
                where: {
                    id: id
                }
            })
            .then(async info => {
                if (info[1]) {
                    const users = await User.findAll({
                        where: {
                            room_id: req.body.room_id
                        }
                    }, {
                        raw: true
                    })
                    room['users'] = users;
                }
            })
        return res.status(200).json(room);
    } else {
        return res.status(404).json({
            errors: `No room with name ${req.body.room_name} found`
        });
    }
});

/**
 * @description GET /api/room/userRelations/:room_id
 */
router.get(
    '/userRelations/:room_id',
    passport.authenticate('jwt', {
        session: false
    }),
    async (req, res) => {
        const privateRs = await Relation.findAll({
            where: {
                user: req.user.id
            }
        }, {
            raw: true
        });
        User.findAndCountAll({
                where: {
                    room_id: req.params.room_id
                }
            })
            .then(async result => {
                const users = result.rows;
                for (const user of users) {
                    const from_st = privateRs.find((privateR) => (privateR['touser'] == user.id));
                    user['dataValues']['from'] = from_st ? from_st.status : 0;
                }
                return res.status(200).json(users);
            })
    }
);

/**
 * @description PUT /api/room/remove/users/:id/all
 */
router.put(
    '/remove/users/all',
    passport.authenticate('jwt', {
        session: false
    }),
    async (req, res) => {
        const updateFields = {
            'room_id': null
        }
        await User.update(updateFields, {
                returning: true,
                raw: true,
                where: {
                    id: req.body.userid
                }
            })
            .then(async info => {
                if (info[1]) {
                    const rooms_p = Room.findAll({}, {
                        raw: true
                    });
                    const users_p = User.findAll({}, {
                        raw: true
                    });

                    Promise.all([rooms_p, users_p]).then((value => {
                            const rooms = value[0];
                            const users = value[1];
                            for (var i = 0; i < rooms.length; i++) {
                                const room = rooms[i];
                                room['user'] = users.filter((user) => user['id'] == room['user']);
                                if (room['user']) {
                                    room['user'] = room['user'][0];
                                }
                                room['users'] = users.filter((user) => user['room_id'] === room['id']).length;
                            }
                            if (rooms) {
                                return res.status(200).json(rooms);
                            } else {
                                return res.status(404).json({
                                    error: 'No Rooms Found'
                                });
                            }
                        }))
                        .catch(err => {
                            console.log('err', err);
                            return res.status(404).json({
                                error: 'No Rooms Found'
                            });
                        });
                }
            });
    }
);
module.exports = router;