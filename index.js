const express = require('express')
const app = express()
const port = 3000
const session = require('express-session')
const FileStore = require('session-file-store')(session)
const md5 = require('js-md5');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bodyParser = require('body-parser');

app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use('/source', express.static('source'));

app.use(session({
  secret: 'random string',
  store: new FileStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 600 * 1000 }
}));

function checkLogin(req) {
    if (!!req.session.loginUser && !!req.session.loginUserId)
        return true;
    return false;
}

function login(req, id, name, admin) {
    return new Promise(resolve => {
        if (checkLogin(req))
            return resolve(false);
        req.session.regenerate(function(err) {
            if (err) {
                return resolve(false);
            }
            req.session.loginUser = name;
            req.session.loginUserId = id;
            req.session.loginAdmin = admin;
            resolve(true);
        });
    });
}

function logout(req) {
    return new Promise(resolve => {
        if (!checkLogin)
            return resolve(false);
        req.session.destroy(function(err) {
            if (err) {
                return resolve(false);
            }
            resolve(true);
        });
    });
}

app.get('/', (req, res) => {
    if (checkLogin(req)) {
        res.redirect('/list');
    } else {
		res.render('login', {
			loginFailure: false,
            sessionExpired: false
		});
    }
});

app.get('/register', async function(req, res) {
    if (checkLogin(req)) {
        res.redirect('/list');
    } else {
        res.render('register', {
            accountDuplicate: false,
            registerSuccess: false,
            registerError: false
        });
    }
});

app.post('/register', async function(req, res) {
    if (checkLogin(req)) {
        res.redirect('/');
    } else {
        const profile = await prisma.profile.findUnique({
            where: { account: req.body.acc }
        });
        if (profile) {
            res.render('register', {
                accountDuplicate: true,
                registerSuccess: false,
                registerError: false
            });
            return;
        }
        const newUser = await prisma.profile.create({
            data: {
                account: req.body.acc,
                password: md5(req.body.pass),
                user: {
                    connectOrCreate: {
                        where: {
                          id: -1
                        },
                        create: { name: req.body.name, }
                    }
                }
            }
        });
        if (newUser) {
            console.log('successful');
            res.render('register', {
                accountDuplicate: false,
                registerSuccess: true,
                registerError: false
            });
        } else {
            console.log('failure');
            res.render('register', {
                accountDuplicate: false,
                registerSuccess: false,
                registerError: true
            });
        }
    }
});

app.post('/login', async function(req, res) {
        const profile = await prisma.profile.findMany();
    if (checkLogin(req)) {
        res.redirect('/list');
    } else {
        const profile = await prisma.profile.findFirst({
            include: { user: true },
            where: { account: req.body.acc, password: md5(req.body.pass)}
        });
        if (profile) {
            const loginStatus = await login(req, profile.userId, profile.user.name, profile.admin);
            
            if (loginStatus) {
                //successful
                res.redirect('/list');
            } else {
                res.render('login', {
                    loginFailure: true,
                    sessionExpired: false
                });
            }
        } else {
            res.render('login', {
                loginFailure: true,
                sessionExpired: false
            });
        }
    }
});

app.get('/logout', async function(req, res) {
    if (!checkLogin(req)) {
		res.render('login', {
			loginFailure: false,
            sessionExpired: false
		});
    } else {
        const logoutStatus = await logout(req);
        
        if (logoutStatus) {
            //successful
            res.clearCookie('connect.sid')
            res.redirect('/');
        } else {
            res.render('login', {
                loginFailure: false,
                sessionExpired: false
            });
        }
    }
});

app.get('/list', async function(req, res) {
    if (!checkLogin(req)) {
		res.render('login', {
			loginFailure: false,
            sessionExpired: true
		});
    } else {
        if (req.session.loginAdmin) {
            const list = await prisma.user.findMany({
                include: {
                    todo: true
                }
            });
            res.render('list', {
                userTodo: list,
                isAdmin: req.session.loginAdmin
            });
        } else {
            const list = await prisma.user.findMany({
                where: {
                    id: req.session.loginUserId
                },
                include: {
                    todo: true
                }
            });
            res.render('list', {
                userTodo: list,
                isAdmin: req.session.loginAdmin
            });
        }
    }
});

app.post('/list/add', async function(req, res) {
    if (!checkLogin(req)) {
		res.status(409).end();
    } else {
        const newTodo = await prisma.todo.create({
            data: {
                event: req.body.event,
                user: {
                    connect: { id: (req.session.loginAdmin? parseInt(req.body.user) : parseInt(req.session.loginUserId)) }
                }
            }
        });
        res.end(JSON.stringify(newTodo));
    }
});

app.post('/list/update', async function(req, res) {
    if (!checkLogin(req)) {
		res.status(409).end();
    } else {
        if (!req.session.loginAdmin) {
            const todoEvent = await prisma.todo.findFirst({
                where: { 
                    id: parseInt(req.body.todoId),
                    userId: parseInt(req.session.loginUserId)
                }
            });
            if (!todoEvent) {
                res.status(500).end();
                return;
            }
        }
        const todo = await prisma.todo.update({
            where: {
                id: parseInt(req.body.todoId),
            },
            data: { done: req.body.done == 'true' }
        });
        res.end(JSON.stringify(todo));
    }
});

app.post('/list/delete', async function(req, res) {
    if (!checkLogin(req)) {
		res.status(409).end();
    } else {
        const todoEvent = await prisma.todo.findFirst({
            where: { 
                id: parseInt(req.body.todoId),
                userId: parseInt(req.session.loginUserId)
            }
        });
        if (!todoEvent)
            res.status(500).end();
        const todo = await prisma.todo.delete({
            where: {
                id: todoEvent.id,
            },
        });
        res.end(JSON.stringify(todo));
    }
});


app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});