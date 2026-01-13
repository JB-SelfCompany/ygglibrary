const path = require('path');
const pckg = require('../../package.json');

const execDir = path.resolve(__dirname, '..');

module.exports = {
    branch: 'unknown',
    version: pckg.version,
    latestVersion: '',
    name: pckg.name,

    execDir,
    dataDir: '',
    tempDir: '',
    logDir: '',
    libDir: '',
    inpx: '',
    inpxFilterFile: '',

    allowConfigRewrite: false,
    allowUnsafeFilter: false,
    accessPassword: '',
    accessTimeout: 0,
    extendedSearch: true,
    bookReadLink: '',
    loggingEnabled: true,
    logServerStats: false,
    logQueries: false,

    //поправить в случае, если были критические изменения в DbCreator или InpxParser
    //иначе будет рассинхронизация по кешу между сервером и клиентом на уровне БД
    dbVersion: '12',
    // Размер кеша БД в блоках. Каждый блок ~1-2MB, 10 блоков = ~10-20MB памяти
    // Для remoteLib автоматически увеличивается до 30 для лучшей производительности
    dbCacheSize: 10,

    maxPayloadSize: 500,//in MB
    maxFilesDirSize: 1024*1024*1024,//1Gb
    queryCacheEnabled: true,
    queryCacheMemSize: 50,
    queryCacheDiskSize: 500,
    cacheCleanInterval: 60,//minutes
    inpxCheckInterval: 60,//minutes
    lowMemoryMode: false,
    fullOptimization: false,

    webConfigParams: ['name', 'version', 'latestVersion', 'branch', 'bookReadLink', 'dbVersion', 'extendedSearch', 'latestReleaseLink', 'uiDefaults'],

    allowRemoteLib: false,
    remoteLib: false,
    /*
    allowRemoteLib: true, // на сервере
    remoteLib: { // на клиенте
        accessPassword: '',
        url: 'wss://remoteInpxWeb.ru',
    },
    */

    server: {
        hosts: ['0.0.0.0'], // array of hosts to bind, e.g. ['192.168.1.23', '192.168.1.24', '200:1234::1']
        port: '22380',
        root: '',
    },

    // Оптимизация для Yggdrasil Network (автоматически применяет TCP keepalive,
    // увеличенные таймауты, WebSocket компрессию)
    yggdrasil: false,
    //opds: false,
    opds: {
        enabled: true,
        user: '',
        password: '',
        root: '/opds',
    },

    latestReleaseLink: 'https://github.com/JB-SelfCompany/ygglibrary/releases/latest',
    checkReleaseLink: 'https://api.github.com/repos/JB-SelfCompany/ygglibrary/releases/latest',

    uiDefaults: {
        limit: 20,
        downloadAsZip: false,
        showCounts: true,
        showRates: true,
        showInfo: true,
        showGenres: true,
        showDates: false,
        showDeleted: false,
        abCacheEnabled: true,
        langDefault: '',
        showJson: false,
        showNewReleaseAvailable: true,
    },
};

