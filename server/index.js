const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const express = require('express');
const http = require('http');
const WebSocket = require ('ws');

const utils = require('./core/utils');

const ayncExit = new (require('./core/AsyncExit'))();

let log;
let config;
let argv;
let branch = '';
const argvStrings = ['host', 'hosts', 'port', 'config', 'data-dir', 'app-dir', 'lib-dir', 'inpx'];

function showHelp(defaultConfig) {
    console.log(utils.versionText(defaultConfig));
    console.log(
`Usage: ${defaultConfig.name} [options]

Options:
  --help               Print ${defaultConfig.name} command line options
  --host=<ip>          Set web server host, default: ${defaultConfig.server.host}
  --hosts=<ip,ip,...>  Set multiple web server hosts (comma-separated), e.g. --hosts=192.168.1.23,192.168.1.24
  --port=<port>        Set web server port, default: ${defaultConfig.server.port}
  --config=<filepath>  Set config filename, default: <dataDir>/config.json
  --data-dir=<dirpath> (or --app-dir) Set application working directory, default: <execDir>/.${defaultConfig.name}
  --lib-dir=<dirpath>  Set library directory, default: the same as ${defaultConfig.name} executable's
  --inpx=<filepath>    Set INPX collection file, default: the one that found in library dir
  --recreate           Force recreation of the search database on start
  --unsafe-filter      Use filter config at your own risk
`
    );
}

async function init() {
    argv = require('minimist')(process.argv.slice(2), {string: argvStrings});
    const argvDataDir = argv['data-dir'] || argv['app-dir'];
    const configFile = argv['config'];

    //config
    const configManager = new (require('./config'))();//singleton
    await configManager.init(argvDataDir, configFile);
    const defaultConfig = configManager.config;

    await configManager.load();
    config = configManager.config;
    branch = config.branch;

    //dirs
    config.dataDir = config.dataDir || argvDataDir || `${config.execDir}/.${config.name}`;
    config.tempDir = config.tempDir || `${config.dataDir}/tmp`;
    if (config.tempDir === '${OS}')
        config.tempDir = `${os.tmpdir()}/${config.name}`

    config.logDir = config.logDir || `${config.dataDir}/log`;    
    config.publicDir = `${config.dataDir}/public`;
    config.publicFilesDir = `${config.dataDir}/public-files`;
    config.rootPathStatic = config.server.root || '';
    config.bookPathStatic = `${config.rootPathStatic}/book`;
    config.bookDir = `${config.publicFilesDir}/book`;

    configManager.config = config;

    await fs.ensureDir(config.dataDir);
    await fs.ensureDir(config.bookDir);
    await fs.ensureDir(config.tempDir);
    await fs.emptyDir(config.tempDir);

    //logger
    const appLogger = new (require('./core/AppLogger'))();//singleton
    await appLogger.init(config);
    log = appLogger.log;

    //cli
    if (argv.help) {
        showHelp(defaultConfig);
        ayncExit.exit(0);
    } else {
        log(utils.versionText(config));
        log('Initializing');
    }

    if (argv.hosts) {
        // Parse comma-separated hosts list
        config.server.hosts = argv.hosts.split(',').map(h => h.trim()).filter(h => h);
    } else if (argv.host) {
        config.server.host = argv.host;
    }

    if (argv.port) {
        config.server.port = argv.port;
    }

    if (!config.remoteLib) {
        const libDir = argv['lib-dir'] || config.libDir;
        if (libDir) {
            if (await fs.pathExists(libDir)) {
                config.libDir = libDir;
            } else {
                throw new Error(`Directory "${libDir}" not exists`);
            }
        } else {
            config.libDir = config.execDir;
        }

        const inpxFile = argv.inpx || config.inpx;
        if (inpxFile) {
            if (await fs.pathExists(inpxFile)) {
                config.inpxFile = inpxFile;
            } else {
                throw new Error(`File "${inpxFile}" not found`);
            }
        } else {
            const inpxFiles = [];
            await utils.findFiles((file) => {
                if (path.extname(file) == '.inpx')
                    inpxFiles.push(file);
            }, config.libDir, false);

            if (inpxFiles.length) {
                if (inpxFiles.length == 1) {
                    config.inpxFile = inpxFiles[0];
                } else {
                    throw new Error(`Found more than one .inpx files: \n${inpxFiles.join('\n')}`);
                }
            } else {
                throw new Error(`No .inpx files found here: ${config.libDir}`);
            }
        }
    } else {
        config.inpxFile = `${config.dataDir}/remote.inpx`;
        const RemoteLib = require('./core/RemoteLib');//singleton
        const remoteLib = new RemoteLib(config);
        await remoteLib.downloadInpxFile();
    }

    config.recreateDb = argv.recreate || false;
    config.inpxFilterFile = config.inpxFilterFile || `${path.dirname(config.configFile)}/filter.json`;
    config.allowUnsafeFilter = argv['unsafe-filter'] || config.allowUnsafeFilter || false;

    //web app
    if (branch !== 'development') {
        const createWebApp = require('./createWebApp');
        await createWebApp(config);
    }

    //log dirs
    for (const prop of ['configFile', 'dataDir', 'tempDir', 'logDir']) {
        log(`${prop}: ${config[prop]}`);
    }

    if (await fs.pathExists(config.inpxFilterFile))
        log(`inpxFilterFile: ${config.inpxFilterFile}`)
}

function logQueries(app) {
    app.use(function(req, res, next) {
        const start = Date.now();
        log(`${req.method} ${req.originalUrl} ${utils.cutString(req.body)}`);
        //log(`${JSON.stringify(req.headers, null, 2)}`)
        res.once('finish', () => {
            log(`${Date.now() - start}ms`);
        });
        next();
    });
}

async function main() {
    const log = new (require('./core/AppLogger'))().log;//singleton

    //server
    const app = express();

    // Determine hosts to bind to
    let hosts = [];
    if (config.server.hosts && config.server.hosts.length > 0) {
        hosts = config.server.hosts;
    } else {
        hosts = [config.server.host];
    }

    // Create WebSocket server with noServer option to handle multiple HTTP servers
    const wss = new WebSocket.Server({ noServer: true, maxPayload: config.maxPayloadSize*1024*1024 });

    // Create HTTP servers for each host
    const servers = [];
    for (const host of hosts) {
        const server = http.createServer(app);

        // Handle WebSocket upgrade for this server
        server.on('upgrade', (request, socket, head) => {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        });

        servers.push({ server, host });
    }

    let devModule = undefined;
    if (branch == 'development') {
        const devFileName = './dev.js'; //require ignored by pkg -50Mb executable size
        devModule = require(devFileName);
        devModule.webpackDevMiddleware(app);
    }

    if (devModule)
        devModule.logQueries(app);

    const opds = require('./core/opds');
    opds(app, config);

    const initStatic = require('./static');
    initStatic(app, config);
    
    const webAccess = new (require('./core/WebAccess'))(config);
    await webAccess.init();

    const { WebSocketController } = require('./controllers');
    new WebSocketController(wss, webAccess, config);

    if (config.logQueries) {
        logQueries(app);
    }

    if (devModule) {
        devModule.logErrors(app);
    } else {
        app.use(function(err, req, res, next) {// eslint-disable-line no-unused-vars
            log(LM_ERR, err.stack);
            res.sendStatus(500);
        });
    }

    // Start all servers
    let startedCount = 0;
    const startPromises = servers.map(({ server, host }) => {
        return new Promise((resolve, reject) => {
            server.listen(config.server.port, host, (err) => {
                if (err) {
                    reject(err);
                } else {
                    startedCount++;
                    log(`Server listening on ${host}:${config.server.port}${host.includes(':') ? ' (IPv6, Yggdrasil compatible)' : ''}`);
                    if (startedCount === servers.length) {
                        config.server.ready = true;
                        if (hosts.length === 1) {
                            log(`Server accessible at http://127.0.0.1:${config.server.port}`);
                        } else {
                            log(`All ${hosts.length} servers started successfully`);
                        }
                    }
                    resolve();
                }
            });
        });
    });

    await Promise.all(startPromises);
}

(async() => {
    try {
        await init();
        await main();
    } catch (e) {
        const mes = (branch == 'development' ? e.stack : e.message);
        if (log)
            log(LM_FATAL, mes);
        else
            console.error(mes);

        ayncExit.exit(1);
    }
})();
