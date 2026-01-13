const fs = require('fs-extra');
const path = require('path');

const InpxParser = require('./InpxParser');
const InpxHashCreator = require('./InpxHashCreator');
const utils = require('./utils');

const emptyFieldValue = '?';

class DbCreator {
    constructor(config) {
        this.config = config;
    }

    async loadInpxFilter() {
        const inpxFilterFile = this.config.inpxFilterFile;

        if (await fs.pathExists(inpxFilterFile)) {
            let filter = await fs.readFile(inpxFilterFile, 'utf8');
            filter = JSON.parse(filter);

            if (filter.includeAuthors) {
                filter.includeAuthors = filter.includeAuthors.map(a => a.toLowerCase());
                filter.includeSet = new Set(filter.includeAuthors);
            }

            if (filter.excludeAuthors) {
                filter.excludeAuthors = filter.excludeAuthors.map(a => a.toLowerCase());
                filter.excludeSet = new Set(filter.excludeAuthors);
            }

            return filter;
        } else {
            return false;
        }
    }

    //процедура формировани БД несколько усложнена, в целях экономии памяти
    async run(db, callback) {
        const config = this.config;

        // Автоматический выбор режима создания БД
        const useStreaming = this.shouldUseStreamingMode();

        if (useStreaming) {
            return await this.runStreaming(db, callback);
        }

        // Legacy mode (текущий код)
        return await this.runLegacy(db, callback);
    }

    /**
     * Определяет, нужно ли использовать streaming режим
     */
    shouldUseStreamingMode() {
        const config = this.config;

        // Если lowMemoryMode включен - используем streaming
        if (config.lowMemoryMode) {
            return true;
        }

        // Проверяем наличие INPX файла
        if (!config.inpxFile) {
            return false;
        }

        // Если размер INPX > 100MB - используем streaming
        const fs = require('fs');
        try {
            const stats = fs.statSync(config.inpxFile);
            if (stats.size > 100 * 1024 * 1024) {
                return true;
            }
        } catch (e) {
            // Файл не найден или ошибка - используем legacy
        }

        return false;
    }

    /**
     * Legacy режим - текущая реализация (все в памяти)
     */
    async runLegacy(db, callback) {
        const config = this.config;

        callback({jobStepCount: 5});
        callback({job: 'load inpx', jobMessage: 'Загрузка INPX', jobStep: 1, progress: 0});

        //временная таблица
        await db.create({
            table: 'book',
            cacheSize: (config.lowMemoryMode ? 5 : 500),
        });        

        //поисковые таблицы, позже сохраним в БД
        let authorMap = new Map();//авторы
        let authorArr = [];
        let seriesMap = new Map();//серии
        let seriesArr = [];
        let titleMap = new Map();//названия
        let titleArr = [];
        let genreMap = new Map();//жанры
        let genreArr = [];
        let langMap = new Map();//языки
        let langArr = [];
        let delMap = new Map();//удаленные
        let delArr = [];
        let dateMap = new Map();//дата поступления
        let dateArr = [];
        let librateMap = new Map();//оценка
        let librateArr = [];
        let extMap = new Map();//тип файла
        let extArr = [];

        let uidSet = new Set();//уникальные идентификаторы

        //stats
        let authorCount = 0;
        let bookCount = 0;
        let noAuthorBookCount = 0;
        let bookDelCount = 0;

        //stuff
        let recsLoaded = 0;
        callback({recsLoaded});
        let chunkNum = 0;

        //фильтр
        const inpxFilter = await this.loadInpxFilter();
        let filter = () => true;
        if (inpxFilter) {

            let recFilter = () => true;
            if (inpxFilter.filter) {
                if (config.allowUnsafeFilter)
                    recFilter = new Function(`'use strict'; return ${inpxFilter.filter}`)();
                else
                    throw new Error(`Unsafe property 'filter' detected in ${this.config.inpxFilterFile}. Please specify '--unsafe-filter' param if you know what you're doing.`);
            }

            filter = (rec) => {
                let author = rec.author;
                if (!author)
                    author = emptyFieldValue;

                author = author.toLowerCase();

                let excluded = false;
                if (inpxFilter.excludeSet) {
                    const authors = author.split(',');

                    for (const a of authors) {
                        if (inpxFilter.excludeSet.has(a)) {
                            excluded = true;
                            break;
                        }
                    }
                }

                return recFilter(rec)
                    && (!inpxFilter.includeSet || inpxFilter.includeSet.has(author))
                    && !excluded
                ;
            };
        }

        //вспомогательные функции
        const splitAuthor = (author) => {
            if (!author)
                author = emptyFieldValue;

            const result = author.split(',');
            if (result.length > 1)
                result.push(author);

            return result;
        }

        let totalFiles = 0;
        const readFileCallback = async(readState) => {
            callback(readState);

            if (readState.totalFiles)
                totalFiles = readState.totalFiles;

            if (totalFiles)
                callback({progress: (readState.current || 0)/totalFiles});
        };

        // ОПТИМИЗИРОВАННАЯ версия parseField
        const parseField = (fieldValue, fieldMap, fieldArr, bookId, rec, fillBookIds = true) => {
            // Быстрая нормализация значения
            let value = fieldValue;
            if (typeof(fieldValue) == 'string') {
                if (!fieldValue)
                    fieldValue = emptyFieldValue;
                value = fieldValue.toLowerCase();
            }

            // Быстрый поиск существующей записи
            let fieldRec = fieldMap.get(value);

            if (!fieldRec) {
                // Создаем новую запись с Array вместо Set (быстрее для больших данных)
                fieldRec = {
                    id: fieldArr.length,
                    value,
                    bookIds: [],
                    bookIdsSet: null // Для быстрой проверки дубликатов при необходимости
                };

                if (rec !== undefined) {
                    fieldRec.name = fieldValue;
                    fieldRec.bookCount = 0;
                    fieldRec.bookDelCount = 0;
                }

                fieldArr.push(fieldRec);
                fieldMap.set(value, fieldRec);
            }

            // Добавляем bookId напрямую в массив (без проверки на дубликаты в рамках одного парсинга)
            if (fieldValue !== emptyFieldValue || fillBookIds) {
                fieldRec.bookIds.push(bookId);
            }

            // Обновляем счетчики
            if (rec !== undefined) {
                if (!rec.del)
                    fieldRec.bookCount++;
                else
                    fieldRec.bookDelCount++;
            }
        };        

        const parseBookRec = (rec) => {
            //авторы
            const author = splitAuthor(rec.author);

            for (let i = 0; i < author.length; i++) {
                const a = author[i];

                //статистика
                if (!authorMap.has(a.toLowerCase()) && (author.length == 1 || i < author.length - 1)) //без соавторов
                    authorCount++;
                
                parseField(a, authorMap, authorArr, rec.id, rec);                
            }

            //серии
            parseField(rec.series, seriesMap, seriesArr, rec.id, rec, false);

            //названия
            parseField(rec.title, titleMap, titleArr, rec.id, rec);

            //жанры
            let genre = rec.genre || emptyFieldValue;
            genre = rec.genre.split(',');

            for (let g of genre) {
                parseField(g, genreMap, genreArr, rec.id);
            }

            //языки
            parseField(rec.lang, langMap, langArr, rec.id);
            
            //удаленные
            parseField(rec.del, delMap, delArr, rec.id);

            //дата поступления
            parseField(rec.date, dateMap, dateArr, rec.id);

            //оценка
            parseField(rec.librate, librateMap, librateArr, rec.id);

            //тип файла
            parseField(rec.ext, extMap, extArr, rec.id);
        };

        //основная процедура парсинга
        let id = 0;
        const parsedCallback = async(chunk) => {
            let filtered = false;
            for (const rec of chunk) {
                //сначала фильтр
                if (!filter(rec) || uidSet.has(rec._uid)) {
                    rec.id = 0;
                    filtered = true;
                    continue;
                }

                rec.id = ++id;
                uidSet.add(rec._uid);

                if (!rec.del) {
                    bookCount++;
                    if (!rec.author)
                        noAuthorBookCount++;
                } else {
                    bookDelCount++;
                }

                parseBookRec(rec);
            }

            let saveChunk = [];
            if (filtered) {
                saveChunk = chunk.filter(r => r.id);
            } else {
                saveChunk = chunk;
            }

            await db.insert({table: 'book', rows: saveChunk});

            recsLoaded += chunk.length;
            callback({recsLoaded});

            // ОПТИМИЗИРОВАННАЯ очистка памяти
            // Вместо каждых 10 чанков - проверяем реальное использование памяти
            if (config.lowMemoryMode && chunkNum++ % 20 == 0) {
                const memUsage = process.memoryUsage();
                // Вызываем GC только если используется > 1GB
                if (memUsage.heapUsed > 1024 * 1024 * 1024) {
                    utils.freeMemory();
                }
            }
        };

        //парсинг
        const parser = new InpxParser();
        await parser.parse(config.inpxFile, readFileCallback, parsedCallback);        

        //чистка памяти, ибо жрет как не в себя
        authorMap = null;
        seriesMap = null;
        titleMap = null;
        genreMap = null;
        langMap = null;
        delMap = null;
        dateMap = null;
        librateMap = null;
        extMap = null;

        uidSet = null;

        await db.close({table: 'book'});
        await db.freeMemory();
        utils.freeMemory();

        //отсортируем таблицы выдадим им правильные id
        //порядок id соответствует ASC-сортировке по value
        callback({job: 'sort', jobMessage: 'Сортировка', jobStep: 2, progress: 0});
        await utils.sleep(100);
        //сортировка авторов
        authorArr.sort((a, b) => a.value.localeCompare(b.value));
        callback({progress: 0.2});
        await utils.sleep(100);

        id = 0;
        for (const authorRec of authorArr) {
            authorRec.id = ++id;
        }
        callback({progress: 0.3});
        await utils.sleep(100);

        //сортировка серий
        seriesArr.sort((a, b) => a.value.localeCompare(b.value));
        callback({progress: 0.5});
        await utils.sleep(100);

        id = 0;
        for (const seriesRec of seriesArr) {
            seriesRec.id = ++id;
        }
        callback({progress: 0.6});
        await utils.sleep(100);

        //сортировка названий
        titleArr.sort((a, b) => a.value.localeCompare(b.value));
        callback({progress: 0.8});
        await utils.sleep(100);        
        id = 0;
        for (const titleRec of titleArr) {
            titleRec.id = ++id;
        }

        //stats
        const stats = {
            filesCount: 0,//вычислим позднее
            filesCountAll: 0,//вычислим позднее
            filesDelCount: 0,//вычислим позднее
            recsLoaded,
            authorCount,
            authorCountAll: authorArr.length,
            bookCount,
            bookCountAll: bookCount + bookDelCount,
            bookDelCount,
            noAuthorBookCount,
            titleCount: titleArr.length,
            seriesCount: seriesArr.length,
            genreCount: genreArr.length,
            langCount: langArr.length,
        };
        //console.log(stats);

        //сохраним поисковые таблицы
        // ОПТИМИЗАЦИЯ: увеличен размер чанка с 10K до 20K для более быстрой вставки
        const chunkSize = 20000;

        const saveTable = async(table, arr, nullArr, indexType = 'string', delEmpty = false) => {

            if (indexType == 'string')
                arr.sort((a, b) => a.value.localeCompare(b.value));
            else
                arr.sort((a, b) => a.value - b.value);

            await db.create({
                table,
                index: {field: 'value', unique: true, type: indexType, depth: 1000000},
            });

            //вставка в БД по кусочкам, экономим память
            for (let i = 0; i < arr.length; i += chunkSize) {
                const chunk = arr.slice(i, i + chunkSize);

                // ОПТИМИЗАЦИЯ: bookIds уже массив, не нужно Array.from()
                // bookIds уже в виде массива после нашей оптимизации parseField

                await db.insert({table, rows: chunk});

                // ОПТИМИЗАЦИЯ: реже вызываем freeMemory
                if (i % 10 == 0) {
                    await db.freeMemory();
                    await utils.sleep(5);
                }

                callback({progress: i/arr.length});
            }

            if (delEmpty) {
                const delResult = await db.delete({table, where: `@@indexLR('value', '?', '?')`});
                const statField = `${table}Count`;
                if (stats[statField])
                    stats[statField] -= delResult.deleted;
            }

            nullArr();
            await db.close({table});
            utils.freeMemory();
            await db.freeMemory();
        };

        //author
        callback({job: 'author save', jobMessage: 'Сохранение индекса авторов', jobStep: 3, progress: 0});
        await saveTable('author', authorArr, () => {authorArr = null});

        //series
        callback({job: 'series save', jobMessage: 'Сохранение индекса серий', jobStep: 4, progress: 0});
        await saveTable('series', seriesArr, () => {seriesArr = null}, 'string', true);

        //title
        callback({job: 'title save', jobMessage: 'Сохранение индекса названий', jobStep: 5, progress: 0});
        await saveTable('title', titleArr, () => {titleArr = null});

        //genre
        callback({job: 'genre save', jobMessage: 'Сохранение индекса жанров', jobStep: 6, progress: 0});
        await saveTable('genre', genreArr, () => {genreArr = null});

        callback({job: 'others save', jobMessage: 'Сохранение остальных индексов', jobStep: 7, progress: 0});
        //lang
        await saveTable('lang', langArr, () => {langArr = null});

        //del
        await saveTable('del', delArr, () => {delArr = null}, 'number');

        //date
        await saveTable('date', dateArr, () => {dateArr = null});

        //librate
        await saveTable('librate', librateArr, () => {librateArr = null}, 'number');

        //ext
        await saveTable('ext', extArr, () => {extArr = null});

        //кэш-таблицы запросов
        await db.create({table: 'query_cache'});
        await db.create({table: 'query_time'});

        //кэш-таблица имен файлов и их хешей
        await db.create({table: 'file_hash'});

        //-- завершающие шаги --------------------------------
        await db.open({
            table: 'book',
            cacheSize: (config.lowMemoryMode ? 5 : 500),
        });

        callback({job: 'optimization', jobMessage: 'Оптимизация', jobStep: 8, progress: 0});
        await this.optimizeTable('author', db, (p) => {
            if (p.progress)
                p.progress = 0.3*p.progress;
            callback(p);
        });
        await this.optimizeTable('series', db, (p) => {
            if (p.progress)
                p.progress = 0.3 + 0.2*p.progress;
            callback(p);
        });
        await this.optimizeTable('title', db, (p) => {
            if (p.progress)
                p.progress = 0.5 + 0.5*p.progress;
            callback(p);
        });

        callback({job: 'stats count', jobMessage: 'Подсчет статистики', jobStep: 9, progress: 0});
        await this.countStats(db, callback, stats);

        //чистка памяти, ибо жрет как не в себя
        await db.close({table: 'book'});
        await db.freeMemory();
        utils.freeMemory();

        //config сохраняем в самом конце, нет конфига - с базой что-то не так
        const inpxHashCreator = new InpxHashCreator(config);

        await db.create({
            table: 'config'
        });

        const inpxInfo = parser.info;
        if (inpxFilter && inpxFilter.info) {
            if (inpxFilter.info.collection)
                inpxInfo.collection = inpxFilter.info.collection;
            if (inpxFilter.info.version)
                inpxInfo.version = inpxFilter.info.version;
        }

        await db.insert({table: 'config', rows: [
            {id: 'inpxInfo', value: inpxInfo},
            {id: 'stats', value: stats},
            {id: 'inpxHash', value: await inpxHashCreator.getHash()},
        ]});

        callback({job: 'done', jobMessage: ''});
    }

    async optimizeTable(from, db, callback) {
        const config = this.config;

        const to = `${from}_book`;

        // Определяем правильный dbPath
        // Для обычной БД: dataDir/.ygglibrary, dbPath = .ygglibrary/db
        // Для master БД: dataDir=db_master, dbPath = db_master
        let dbPath;
        if (config.dataDir.endsWith('db_master')) {
            // Master БД - БД находится прямо в db_master
            dbPath = config.dataDir;
        } else {
            // Обычная БД - БД находится в dataDir/db
            dbPath = path.join(config.dataDir, 'db');
        }

        await db.open({table: from});
        await db.create({table: to});

        let bookId2RecId = new Map();

        const saveChunk = async(chunk) => {
            const ids = [];
            for (const rec of chunk) {
                for (const id of rec.bookIds) {
                    let b2r = bookId2RecId.get(id);
                    if (!b2r) {
                        b2r = [];
                        bookId2RecId.set(id, b2r);
                    }
                    b2r.push(rec.id);

                    ids.push(id);
                }
            }

            if (config.fullOptimization) {
                ids.sort((a, b) => a - b);// обязательно, иначе будет тормозить - особенности JembaDb

                const rows = await db.select({table: 'book', where: `@@id(${db.esc(ids)})`});

                const bookArr = new Map();
                for (const row of rows)
                    bookArr.set(row.id, row);

                for (const rec of chunk) {
                    rec.books = [];

                    for (const id of rec.bookIds) {
                        const book = bookArr.get(id);
                        if (book) {//на всякий случай
                            rec.books.push(book);
                        }
                    }

                    delete rec.name;
                    delete rec.value;
                    delete rec.bookIds;
                }

                await db.insert({
                    table: to,
                    rows: chunk,
                });
            }
        };

        const rows = await db.select({table: from, count: true});
        const fromLength = rows[0].count;

        let processed = 0;
        while (1) {// eslint-disable-line
            const chunk = await db.select({
                table: from,
                where: `
                    let iter = @getItem('optimize');
                    if (!iter) {
                        iter = @all();
                        @setItem('optimize', iter);
                    }

                    const ids = new Set();
                    let bookIdsLen = 0;
                    let id = iter.next();
                    while (!id.done) {
                        ids.add(id.value);

                        const row = @row(id.value);
                        bookIdsLen += row.bookIds.length;
                        if (bookIdsLen >= 50000)
                            break;

                        id = iter.next();
                    }

                    return ids;
                `
            });

            if (chunk.length) {
                await saveChunk(chunk);

                processed += chunk.length;
                callback({progress: 0.9*processed/fromLength});
            } else
                break;

            if (this.config.lowMemoryMode) {
                await utils.sleep(10);
                utils.freeMemory();
                await db.freeMemory();
            }
        }

        await db.close({table: to});
        await db.close({table: from});

        const idMap = {arr: [], map: []};
        for (const [id, value] of bookId2RecId) {
            if (value.length > 1) {
                idMap.map.push([id, value]);
                idMap.arr[id] = 0;
            } else {
                idMap.arr[id] = value[0];
            }
        }

        callback({progress: 1});
        await fs.writeFile(path.join(dbPath, `${from}_id.map`), JSON.stringify(idMap));

        bookId2RecId = null;
        utils.freeMemory();
    }

    async countStats(db, callback, stats) {
        //статистика по количеству файлов

        //эмуляция прогресса
        let countDone = false;
        (async() => {
            let i = 0;
            while (!countDone) {
                callback({progress: i/100});
                i = (i < 100 ? i + 5 : 100);
                await utils.sleep(1000);
            }
        })();

        //подчсет
        const countRes = await db.select({table: 'book', rawResult: true, where: `
            const files = new Set();
            const filesDel = new Set();

            for (const id of @all()) {
                const r = @row(id);
                const file = ${"`${r.folder}/${r.file}.${r.ext}`"};
                if (!r.del) {
                    files.add(file);
                } else {
                    filesDel.add(file);
                }
            }

            for (const file of filesDel)
                if (files.has(file))
                    filesDel.delete(file);

            return {filesCount: files.size, filesDelCount: filesDel.size};
        `});

        if (countRes.length) {
            const res = countRes[0].rawResult;
            stats.filesCount = res.filesCount;
            stats.filesCountAll = res.filesCount + res.filesDelCount;
            stats.filesDelCount = res.filesDelCount;
        }

        //заодно добавим нужный индекс
        await db.create({
            in: 'book',
            hash: {field: '_uid', type: 'string', depth: 100, unique: true},
        });

        countDone = true;
    }

    /**
     * Streaming режим - создание БД без хранения Map/Set в памяти
     * Используется для больших библиотек и при lowMemoryMode
     */
    async runStreaming(db, callback) {
        const config = this.config;
        const log = new (require('./AppLogger'))().log;

        log(LM_INFO, 'Using STREAMING mode for DB creation (low memory usage)');

        callback({jobStepCount: 7});
        callback({job: 'load inpx (streaming)', jobMessage: 'Загрузка INPX (экономия памяти)', jobStep: 1, progress: 0});

        // Создаем временную таблицу для книг
        await db.create({
            table: 'book_temp',
            cacheSize: 5, // Минимальный кеш
        });

        // Фильтр
        const inpxFilter = await this.loadInpxFilter();
        let filter = () => true;
        if (inpxFilter) {
            let recFilter = () => true;
            if (inpxFilter.filter) {
                if (config.allowUnsafeFilter)
                    recFilter = new Function(`'use strict'; return ${inpxFilter.filter}`)();
                else
                    throw new Error(`Unsafe property 'filter' detected in ${this.config.inpxFilterFile}. Please specify '--unsafe-filter' param if you know what you're doing.`);
            }

            filter = (rec) => {
                let author = rec.author;
                if (!author)
                    author = emptyFieldValue;

                author = author.toLowerCase();

                let excluded = false;
                if (inpxFilter.excludeSet) {
                    const authors = author.split(',');

                    for (const a of authors) {
                        if (inpxFilter.excludeSet.has(a)) {
                            excluded = true;
                            break;
                        }
                    }
                }

                return recFilter(rec)
                    && (!inpxFilter.includeSet || inpxFilter.includeSet.has(author))
                    && !excluded
                ;
            };
        }

        // Вспомогательные функции
        const splitAuthor = (author) => {
            if (!author)
                author = emptyFieldValue;

            const result = author.split(',');
            if (result.length > 1)
                result.push(author);

            return result;
        };

        const parseBookRec = (rec) => {
            // Разбираем авторов
            const authors = splitAuthor(rec.author);
            rec.author_norm = authors.map(a => a.toLowerCase()).join(',');

            // Нормализуем серию
            rec.series_norm = (rec.series || emptyFieldValue).toLowerCase();

            // Нормализуем название
            rec.title_norm = (rec.title || emptyFieldValue).toLowerCase();

            // Парсим жанры
            let genre = rec.genre || emptyFieldValue;
            rec.genre_arr = genre.split(',');

            return rec;
        };

        // Этап 1: Парсинг и запись в book_temp БЕЗ проверки дубликатов
        let id = 0;
        let recsLoaded = 0;
        let chunkNum = 0;

        callback({recsLoaded});

        let totalFiles = 0;
        const readFileCallback = async(readState) => {
            callback(readState);

            if (readState.totalFiles)
                totalFiles = readState.totalFiles;

            if (totalFiles)
                callback({progress: (readState.current || 0)/totalFiles});
        };

        const parsedCallback = async(chunk) => {
            const rows = [];

            for (const rec of chunk) {
                // Применяем фильтр
                if (!filter(rec)) {
                    continue;
                }

                rec.id = ++id;
                parseBookRec(rec);
                rows.push(rec);
            }

            if (rows.length > 0) {
                await db.insert({table: 'book_temp', rows});
            }

            recsLoaded += chunk.length;
            callback({recsLoaded});

            // Чистим память каждые 10 чанков
            if (chunkNum++ % 10 == 0) {
                utils.freeMemory();
                await db.freeMemory();
            }
        };

        // Парсим INPX
        const parser = new InpxParser();
        await parser.parse(config.inpxFile, readFileCallback, parsedCallback);

        await db.close({table: 'book_temp'});
        utils.freeMemory();

        log(LM_INFO, `Parsed ${id} books, removing duplicates...`);

        // Этап 2: Удаление дубликатов по _uid
        callback({job: 'remove duplicates', jobMessage: 'Удаление дубликатов', jobStep: 2, progress: 0});
        await this.removeDuplicatesStreaming(db, callback);

        // Этап 3: Создание индексов author, series, title
        callback({job: 'create indexes', jobMessage: 'Создание индексов', jobStep: 3, progress: 0});
        await this.createIndexesStreaming(db, callback);

        // Этап 4: Переименование book_temp -> book через файловую систему
        callback({job: 'finalize', jobMessage: 'Финализация', jobStep: 4, progress: 0});

        // Закрываем таблицу перед переименованием
        await db.close({table: 'book_temp'});

        // Переименовываем файлы таблицы на уровне файловой системы
        const dbPath = path.join(config.dataDir, 'db');
        const tempTablePath = path.join(dbPath, 'book_temp');
        const bookTablePath = path.join(dbPath, 'book');

        // Удаляем book если существует
        if (await fs.pathExists(bookTablePath)) {
            await fs.remove(bookTablePath);
        }

        // Переименовываем
        await fs.rename(tempTablePath, bookTablePath);

        // Этап 5: Создание остальных индексов (genre, lang, del, date, librate, ext)
        callback({job: 'other indexes', jobMessage: 'Создание дополнительных индексов', jobStep: 5, progress: 0});
        await this.createOtherIndexesStreaming(db, callback);

        // Этап 6: Оптимизация (если включена)
        if (config.fullOptimization) {
            callback({job: 'optimization', jobMessage: 'Оптимизация', jobStep: 6, progress: 0});
            await this.optimizeTable('author', db, callback);
            await this.optimizeTable('series', db, callback);
            await this.optimizeTable('title', db, callback);
        }

        // Этап 7: Кэш-таблицы, статистика и config
        callback({job: 'finalize', jobMessage: 'Завершение', jobStep: 7, progress: 0});

        // Кэш-таблицы
        await db.create({table: 'query_cache'});
        await db.create({table: 'query_time'});
        await db.create({table: 'file_hash'});

        // Статистика
        await db.open({table: 'book', cacheSize: 5});
        const stats = await this.countStatsStreaming(db, callback);
        await db.close({table: 'book'});

        // Config
        const inpxHashCreator = new InpxHashCreator(config);
        await db.create({table: 'config'});

        const inpxInfo = parser.info;
        if (inpxFilter && inpxFilter.info) {
            if (inpxFilter.info.collection)
                inpxInfo.collection = inpxFilter.info.collection;
            if (inpxFilter.info.version)
                inpxInfo.version = inpxFilter.info.version;
        }

        await db.insert({table: 'config', rows: [
            {id: 'inpxInfo', value: inpxInfo},
            {id: 'stats', value: stats},
            {id: 'inpxHash', value: await inpxHashCreator.getHash()},
        ]});

        callback({job: 'done', jobMessage: ''});

        log(LM_INFO, 'DB created successfully in STREAMING mode');
    }

    /**
     * Удаляет дубликаты книг по _uid
     */
    async removeDuplicatesStreaming(db, callback) {
        await db.open({table: 'book_temp'});

        // Создаем hash индекс по _uid для быстрого поиска
        await db.create({
            in: 'book_temp',
            hash: {field: '_uid', type: 'string', depth: 100, unique: false},
        });

        // Находим дубликаты и оставляем только первые записи
        const duplicates = await db.select({
            table: 'book_temp',
            rawResult: true,
            where: `
                const uidMap = new Map();
                const toDelete = [];

                for (const id of @all()) {
                    const row = @row(id);
                    if (uidMap.has(row._uid)) {
                        toDelete.push(id);
                    } else {
                        uidMap.set(row._uid, id);
                    }
                }

                return toDelete;
            `
        });

        if (duplicates.length > 0 && duplicates[0].rawResult) {
            const toDelete = duplicates[0].rawResult;
            if (toDelete.length > 0) {
                await db.delete({
                    table: 'book_temp',
                    where: `@@id(${db.esc(toDelete)})`
                });
            }
        }

        await db.close({table: 'book_temp'});
        callback({progress: 1});
    }

    /**
     * Создает индексы author, series, title путем итерации по БД
     */
    async createIndexesStreaming(db, callback) {
        await this.createIndexStreaming(db, 'author', 'author_norm', callback);
        await this.createIndexStreaming(db, 'series', 'series_norm', callback);
        await this.createIndexStreaming(db, 'title', 'title_norm', callback);
    }

    /**
     * Создает один индекс путем группировки
     */
    async createIndexStreaming(db, tableName, fieldName, callback) {
        await db.open({table: 'book_temp'});
        await db.create({table: tableName});

        const indexMap = new Map();
        const CHUNK_SIZE = 5000;

        // Читаем книги по частям
        let processed = 0;
        const totalRows = await db.select({table: 'book_temp', count: true});
        const total = totalRows[0].count;

        while (true) {
            const chunk = await db.select({
                table: 'book_temp',
                limit: CHUNK_SIZE,
                offset: processed
            });

            if (chunk.length === 0) break;

            for (const book of chunk) {
                const values = book[fieldName].split(',');

                for (const value of values) {
                    const val = value.trim();
                    if (!val) continue;

                    if (!indexMap.has(val)) {
                        indexMap.set(val, {
                            value: val,
                            bookIds: [],
                            bookCount: 0,
                            bookDelCount: 0,
                            name: book[fieldName.replace('_norm', '')]
                        });
                    }

                    const rec = indexMap.get(val);
                    rec.bookIds.push(book.id);
                    if (!book.del) {
                        rec.bookCount++;
                    } else {
                        rec.bookDelCount++;
                    }
                }
            }

            processed += chunk.length;
            callback({progress: processed / total / 3});

            // Периодически сохраняем и чистим Map
            if (indexMap.size > 50000) {
                await this.saveIndexChunk(db, tableName, indexMap);
                indexMap.clear();
                utils.freeMemory();
                await db.freeMemory();
            }
        }

        // Сохраняем остаток
        if (indexMap.size > 0) {
            await this.saveIndexChunk(db, tableName, indexMap);
        }

        await db.close({table: tableName});
        await db.close({table: 'book_temp'});

        callback({progress: 1});
    }

    /**
     * Сохраняет часть индекса в БД
     */
    async saveIndexChunk(db, tableName, indexMap) {
        const rows = Array.from(indexMap.values()).sort((a, b) => a.value.localeCompare(b.value));

        for (const row of rows) {
            row.id = rows.indexOf(row) + 1;
        }

        await db.insert({table: tableName, rows});
    }

    /**
     * Создает остальные индексы (genre, lang, del, date, librate, ext)
     */
    async createOtherIndexesStreaming(db, callback) {
        await db.open({table: 'book'});

        // Простые индексы создаем аналогично
        const indexes = [
            {name: 'genre', field: 'genre', type: 'string'},
            {name: 'lang', field: 'lang', type: 'string'},
            {name: 'del', field: 'del', type: 'number'},
            {name: 'date', field: 'date', type: 'string'},
            {name: 'librate', field: 'librate', type: 'number'},
            {name: 'ext', field: 'ext', type: 'string'}
        ];

        for (const idx of indexes) {
            await this.createSimpleIndexStreaming(db, idx.name, idx.field, idx.type, callback);
        }

        await db.close({table: 'book'});
    }

    /**
     * Создает простой индекс (не требует разбора на части)
     */
    async createSimpleIndexStreaming(db, tableName, fieldName, indexType, callback) {
        await db.create({
            table: tableName,
            index: {field: 'value', unique: true, type: indexType, depth: 1000000},
        });

        const indexMap = new Map();
        const CHUNK_SIZE = 5000;

        let processed = 0;
        const totalRows = await db.select({table: 'book', count: true});
        const total = totalRows[0].count;

        while (true) {
            const chunk = await db.select({
                table: 'book',
                limit: CHUNK_SIZE,
                offset: processed
            });

            if (chunk.length === 0) break;

            for (const book of chunk) {
                const value = book[fieldName];

                if (!indexMap.has(value)) {
                    indexMap.set(value, {
                        value,
                        bookIds: [],
                    });
                }

                indexMap.get(value).bookIds.push(book.id);
            }

            processed += chunk.length;
        }

        // Сортируем и сохраняем
        const rows = Array.from(indexMap.values());
        if (indexType === 'string') {
            rows.sort((a, b) => a.value.localeCompare(b.value));
        } else {
            rows.sort((a, b) => a.value - b.value);
        }

        for (let i = 0; i < rows.length; i++) {
            rows[i].id = i + 1;
        }

        await db.insert({table: tableName, rows});
        await db.close({table: tableName});
    }

    /**
     * Считает статистику для streaming режима
     */
    async countStatsStreaming(db, callback) {
        // Подсчет через итерацию
        const result = await db.select({
            table: 'book',
            rawResult: true,
            where: `
                let bookCount = 0;
                let bookDelCount = 0;
                let noAuthorBookCount = 0;
                const authorSet = new Set();
                const files = new Set();
                const filesDel = new Set();

                for (const id of @all()) {
                    const r = @row(id);

                    if (!r.del) {
                        bookCount++;
                        if (!r.author || r.author === '?')
                            noAuthorBookCount++;
                    } else {
                        bookDelCount++;
                    }

                    // Авторы
                    if (r.author && r.author !== '?') {
                        const authors = r.author.split(',');
                        for (const a of authors) {
                            authorSet.add(a.trim().toLowerCase());
                        }
                    }

                    // Файлы
                    const file = ${"`${r.folder}/${r.file}.${r.ext}`"};
                    if (!r.del) {
                        files.add(file);
                    } else {
                        filesDel.add(file);
                    }
                }

                // Убираем пересечения из удаленных
                for (const file of filesDel) {
                    if (files.has(file))
                        filesDel.delete(file);
                }

                return {
                    bookCount,
                    bookDelCount,
                    bookCountAll: bookCount + bookDelCount,
                    noAuthorBookCount,
                    authorCount: authorSet.size,
                    filesCount: files.size,
                    filesDelCount: filesDel.size,
                    filesCountAll: files.size + filesDel.size
                };
            `
        });

        // Получаем остальные counts из таблиц
        const authorRows = await db.select({table: 'author', count: true});
        const seriesRows = await db.select({table: 'series', count: true});
        const titleRows = await db.select({table: 'title', count: true});
        const genreRows = await db.select({table: 'genre', count: true});
        const langRows = await db.select({table: 'lang', count: true});

        const stats = result[0].rawResult;
        stats.authorCountAll = authorRows[0].count;
        stats.seriesCount = seriesRows[0].count;
        stats.titleCount = titleRows[0].count;
        stats.genreCount = genreRows[0].count;
        stats.langCount = langRows[0].count;

        // Создаем hash индекс по _uid
        await db.create({
            in: 'book',
            hash: {field: '_uid', type: 'string', depth: 100, unique: true},
        });

        return stats;
    }
}

module.exports = DbCreator;